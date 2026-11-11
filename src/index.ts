/**
 * Forge router: wiring only, no business logic (CONVENTIONS §2, R2 §2).
 *
 * Three entry points share one dependency graph:
 *   1. `handler` — `@forge/resolver` definitions: the four screens and the
 *      seven actions under their SPEC §10 keys;
 *   2. `dispatch` — the plain `(payload, context)` function the `action` and
 *      `rovo:mcp` modules call (R2 §2.1: an action is NOT a resolver);
 *   3. `onEvent` / `onScheduled` / `onMessage` — the trigger, scheduledTrigger
 *      and consumer modules, delegated to src/triggers/*.
 *
 * Every collaborator is built here and injected; no global, no hidden state.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import Resolver from '@forge/resolver';
import { Queue } from '@forge/events';
import api from '@forge/api';
import { createStore } from './db/repo.js';
import { createJiraClient } from './collect/jira-client.js';
import { createJsmClient } from './collect/jsm.js';
import { createConfluenceClient } from './collect/confluence.js';
import { createTeamworkGraphRunner } from './collect/graph.js';
import { createReleaseCollector } from './collect/collector.js';
import { createLlmNarrativeWriter } from './collect/llm.js';
import { listOpenVersions, listReleasedVersions, listVersionsForIssue } from './db/queries.js';
import { createForgeSqlClient } from './db/sql-client.js';
import type { SqlClient } from './db/sql-client.js';
import { ACTION_KEYS, runAction } from './actions/registry.js';
import { ActionError, makeViewer } from './actions/types.js';
import type { ActionDeps, DossierIndex } from './actions/types.js';
import { recomputeRelease, resolvePolicy } from './engine/pipeline.js';
import { createMemoryGate, onJiraEvent } from './triggers/events.js';
import type { JiraEventLike } from './triggers/events.js';
import { onScheduled as runScheduled } from './triggers/scheduled.js';
import type { ScheduledPayload, ScheduledVersionSource } from './triggers/scheduled.js';
import { onMessage as runConsumer } from './triggers/consumer.js';
import type { RecomputeFn } from './triggers/consumer.js';
import type {
  Clock,
  JobQueue,
  Logger,
  PipelineDeps,
  RecomputeMessage,
  ReleaseStore,
} from './ports.js';
import type { Policy } from './types.js';
import type { ForgeRequest } from './collect/paging.js';

/* ------------------------------------------------------------ primitives */

const clock: Clock = { now: () => new Date().toISOString() };

const logger: Logger = {
  log(level, message, meta) {
    const line = `[rayon-impact] ${message}`;
    if (level === 'error') console.error(line, meta ?? '');
    else if (level === 'warn') console.warn(line, meta ?? '');
    else console.log(line, meta ?? '');
  },
};

/** Forge `context` (R2 §2.2): identity only, never authorisation by input. */
interface ForgeContext {
  principal?: { accountId?: string };
  moduleKey?: string;
  cloudId?: string;
}

/** Action invocations also carry the Atlassian context inside the payload. */
interface ForgePayload extends Record<string, unknown> {
  action?: string;
  context?: { moduleKey?: string };
}

/** The queue key must match the `consumer` module of the manifest. */
export const QUEUE_KEY = 'rayon-recalc';

const queue = new Queue({ key: QUEUE_KEY });

const jobQueue: JobQueue = {
  async publish(message: RecomputeMessage): Promise<void> {
    await queue.push({ body: message as unknown as Record<string, unknown> });
  },
};

/* ---------------------------------------------------------- dependencies */

/** The dossier index: saved dossiers only, never a live collection. */
function buildIndex(store: ReleaseStore): DossierIndex {
  return {
    async resolveVersion(projectKey, versionName) {
      const client = createJiraClient();
      const versions = await client.listProjectVersions(projectKey);
      const found = versions.find((candidate) => candidate.name === versionName);
      if (!found) return null;
      return {
        projectId: String(found.projectId ?? ''),
        projectKey,
        versionId: String(found.id),
        versionName: found.name,
      };
    },
    async getFacts(versionId) {
      const cached = await store.getCollection(versionId);
      if (!cached) return null;
      return { cachedAt: cached.collectedAt, release: cached.release };
    },
    async findSignal(signalId) {
      const found = await store.getSignalById(signalId);
      if (!found) return null;
      return { versionId: found.versionId, signal: found.signal };
    },
  };
}

/** One dependency graph per invocation: `createStore()` opens SQL lazily. */
function createDeps(context: ForgeContext): ActionDeps {
  const store: ReleaseStore = createStore();
  return {
    store,
    index: buildIndex(store),
    clock,
    logger,
    viewer: makeViewer(context.principal?.accountId ?? 'anonymous'),
  };
}

/* --------------------------------------------------------------- screens */

const required = (payload: ForgePayload, field: string): string => {
  const value = payload[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ActionError('invalid-input', `Screen payload needs a "${field}" string.`);
  }
  return value;
};

/** Screen invocations (SPEC §11): always the last saved dossier (SPEC §12). */
const SCREENS: Record<string, (payload: ForgePayload, deps: ActionDeps) => Promise<unknown>> = {
  'screen.projectPage': async (payload, deps) =>
    deps.store.getDossier(required(payload, 'versionId')),
  'screen.projectSettings': async (payload, deps) =>
    deps.store.getPolicy(required(payload, 'projectId')),
  'screen.dashboardGadget': async (payload, deps) =>
    deps.store.listSnapshots(required(payload, 'projectId'), 20),
  'screen.issueContext': async (payload, deps) => {
    const issueId = required(payload, 'issueId');
    const versions = await listVersionsForIssue(sql(), issueId);
    const dossiers = await Promise.all(
      versions.map(async (row) => ({
        versionId: row.version_id,
        versionName: row.version_name,
        dossier: await deps.store.getDossier(row.version_id),
      })),
    );
    return { issueId, versions: dossiers };
  },
};

/** A SQL client of its own for the read-only version queries. */
function sql(): SqlClient {
  return createForgeSqlClient();
}

/* --------------------------------------------------------------- actions */

/** `payload.action` (resolver) or `payload.context.moduleKey` (action module, R2 §2.2). */
const actionKeyOf = (payload: ForgePayload, context: ForgeContext): string => {
  const key = payload.action ?? payload.context?.moduleKey ?? context.moduleKey;
  if (!key) {
    throw new ActionError(
      'invalid-input',
      `Cannot tell which action to run; expected one of ${ACTION_KEYS.join(', ')}.`,
    );
  }
  return key;
};

/** A refusal reaches the agent as data, not as a platform failure. */
const refusal = (error: unknown): unknown =>
  error instanceof ActionError
    ? { ok: false, error: { code: error.code, message: error.message } }
    : Promise.reject(error);

/** Forge function of the `action` / `rovo:mcp` modules: `(payload, context)` (R2 §2.2). */
export async function dispatch(payload: ForgePayload, context: ForgeContext): Promise<unknown> {
  const key = actionKeyOf(payload, context);
  try {
    return { ok: true, action: key, result: await runAction(key, payload, createDeps(context)) };
  } catch (error) {
    return refusal(error);
  }
}

/* ---------------------------------------------------------------- router */

const resolver = new Resolver();

for (const key of ACTION_KEYS) {
  resolver.define(key, async (request: { payload?: ForgePayload; context: ForgeContext }) => {
    try {
      return await runAction(key, request.payload ?? {}, createDeps(request.context));
    } catch (error) {
      return refusal(error);
    }
  });
}

for (const [key, screen] of Object.entries(SCREENS)) {
  resolver.define(key, (request: { payload?: ForgePayload; context: ForgeContext }) =>
    screen(request.payload ?? {}, createDeps(request.context)),
  );
}

/** `@forge/resolver` definitions — `handler` of every UI module. */
export const handler = resolver.getDefinitions();

/* -------------------------------------------------------------- triggers */

/** The collector, built for one project: the policy is per project. */
function buildCollector(
  policy: Policy,
  cloudId: string | null,
  viewerAccountId: string,
): PipelineDeps['collector'] {
  const jiraClient = createJiraClient();
  const jsmClient = createJsmClient(api.asApp().requestJira as unknown as ForgeRequest);
  const confluenceClient = createConfluenceClient(
    api.asApp().requestConfluence as unknown as ForgeRequest,
  );
  // The Teamwork Graph is read in a user session only (SPEC §12): without a
  // viewer the app falls back to the JQL development information.
  const graphRunner =
    cloudId && viewerAccountId ? createTeamworkGraphRunner(viewerAccountId) : null;
  return createReleaseCollector({
    policy,
    jiraClient,
    jsmClient,
    confluenceClient,
    graphRunner,
    cloudId,
    clock,
    logger,
  });
}

/** Pipeline collaborators, assembled for one project. */
async function pipelineDeps(projectId: string, cloudId: string | null): Promise<PipelineDeps> {
  const store: ReleaseStore = createStore();
  const policy = await resolvePolicy(store, projectId);
  return {
    store,
    collector: buildCollector(policy, cloudId, ''),
    narrative: createLlmNarrativeWriter(logger),
    clock,
    logger,
  };
}

/** `trigger` module: Jira version, issue and issue-link events. */
export async function onEvent(event: JiraEventLike): Promise<RecomputeMessage[]> {
  return onJiraEvent(event, { queue: jobQueue, gate: createMemoryGate(), clock, logger });
}

/** `scheduledTrigger` modules: hourly refresh and the 72 h outcome check. */
export async function onScheduled(payload: ScheduledPayload): Promise<RecomputeMessage[]> {
  const store: ReleaseStore = createStore();
  const versions: ScheduledVersionSource = {
    async listOpenVersions() {
      const rows = await listOpenVersions(sql(), payload.context?.cloudId ?? '');
      return rows.map((row) => ({
        versionId: row.version_id,
        versionName: row.version_name,
        projectId: row.project_id,
        released: Boolean(row.version_released),
        computedAt: row.computed_at,
      }));
    },
    async listReleasedVersions(beforeIso: string) {
      const rows = await listReleasedVersions(
        sql(),
        payload.context?.cloudId ?? '',
        beforeIso,
      );
      return rows.map((row) => ({
        versionId: row.version_id,
        versionName: row.version_name,
        projectId: row.project_id,
        released: Boolean(row.version_released),
        computedAt: row.computed_at,
      }));
    },
  };
  return runScheduled(payload, {
    queue: jobQueue,
    gate: createMemoryGate(),
    clock,
    logger,
    store,
    versions,
  });
}

/** `consumer` module: drains one recompute message. */
export async function onMessage(message: RecomputeMessage): Promise<unknown> {
  const deps = await pipelineDeps(message.projectId, null);
  const recompute: RecomputeFn = async (pipeline, request) =>
    recomputeRelease(pipeline, request);
  return runConsumer(message, { pipeline: deps, recompute, logger });
}

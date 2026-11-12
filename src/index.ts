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
import { createStore } from './db/repo';
import { defineSchemaOnce } from './db/schema';
import { SITE_CONFIG } from './config';
import { createJiraClient } from './collect/jira-client';
import { createJsmClient } from './collect/jsm';
import { createConfluenceClient } from './collect/confluence';
import { createTeamworkGraphRunner } from './collect/graph';
import { createReleaseCollector } from './collect/collector';
import { createLlmNarrativeWriter } from './collect/llm';
import {
  listOpenVersions,
  listReleasedVersions,
  listVersions,
  listVersionsForIssue,
} from './db/queries';
import { DEFAULT_RETENTION, pruneSnapshots } from './db/retention';
import { createForgeSqlClient } from './db/sql-client';
import type { SqlClient } from './db/sql-client';
import { ACTION_KEYS, runAction } from './actions/registry';
import { ActionError, makeViewer } from './actions/types';
import type { ActionDeps, DossierIndex } from './actions/types';
import { recomputeOutcome, recomputeRelease, resolvePolicy } from './engine/pipeline';
import { buildImpactGraph } from './engine/graph';
import { diffSnapshots } from './engine/diff';
import { onJiraEvent } from './triggers/events';
import { createFailOpenSqlGate } from './db/gate';
import type { JiraEventLike } from './triggers/events';
import { onScheduled as runScheduled, scheduledMode } from './triggers/scheduled';
import type { ScheduledPayload, ScheduledVersionSource } from './triggers/scheduled';
import { onMessage as runConsumer } from './triggers/consumer';
import { sleep } from './triggers/trailing';
import type { RecomputeFn } from './triggers/consumer';
import type {
  Clock,
  JobQueue,
  Logger,
  PipelineDeps,
  RecomputeMessage,
  ReleaseStore,
} from './ports';
import type { Policy } from './types';
import type { ForgeRequest } from './collect/paging';

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

/**
 * Applies the SQL schema once per warm runtime (SPEC §13). A failure is logged,
 * never thrown: a missing table must not take the whole invocation down.
 */
async function ensureSchema(): Promise<void> {
  try {
    await defineSchemaOnce();
  } catch (error) {
    logger.log('warn', 'schema SQL indisponible', {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

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
async function createDeps(context: ForgeContext): Promise<ActionDeps> {
  await ensureSchema();
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
  'screen.dashboardGadget': async (payload, deps) => {
    const projectId = required(payload, 'projectId');
    const snapshots = await deps.store.listSnapshots(projectId, 20);
    // The release date lives in the cached collection, not in the snapshot.
    return Promise.all(
      snapshots.map(async (snapshot) => {
        const cached = await deps.store.getCollection(snapshot.versionId);
        return {
          versionId: snapshot.versionId,
          versionName: snapshot.versionName,
          verdict: snapshot.verdict,
          confidence: snapshot.confidence,
          computedAt: snapshot.computedAt,
          releaseDate: cached?.release.version.releaseDate ?? null,
        };
      }),
    );
  },
  /** RI-12: the impact graph, built from the cached collection and the signals. */
  'screen.impactGraph': async (payload, deps) => {
    const versionId = required(payload, 'versionId');
    const cached = await deps.store.getCollection(versionId);
    const dossier = await deps.store.getDossier(versionId);
    if (!cached || !dossier) return null;
    return buildImpactGraph(cached.release, dossier.signals);
  },
  /** RI-14: what changed between the last two dossiers of a version. */
  'screen.projectDiff': async (payload, deps) => {
    const projectId = required(payload, 'projectId');
    const versionId = required(payload, 'versionId');
    const snapshots = (await deps.store.listSnapshots(projectId, 10)).filter(
      (snapshot) => snapshot.versionId === versionId,
    );
    if (snapshots.length < 2) return null;
    const [current, previous] = snapshots;
    const [currentSignals, previousSignals] = await Promise.all([
      deps.store.getSignals(current.id),
      deps.store.getSignals(previous.id),
    ]);
    return diffSnapshots(
      { snapshot: previous, signals: previousSignals },
      { snapshot: current, signals: currentSignals },
    );
  },
  /** RI-01: the versions of a project with their current verdict. */
  'screen.projectVersions': async (payload, deps) => {
    const projectId = required(payload, 'projectId');
    const snapshots = await deps.store.listSnapshots(projectId, 50);
    return snapshots.map((snapshot) => ({
      versionId: snapshot.versionId,
      versionName: snapshot.versionName,
      verdict: snapshot.verdict,
      confidence: snapshot.confidence,
      computedAt: snapshot.computedAt,
      released: snapshot.versionReleased,
    }));
  },
  /** Settings screen: the policy is saved as a whole (RI-11). */
  'screen.savePolicy': async (payload, deps) => {
    const policy = payload.policy as Policy | undefined;
    if (!policy || typeof policy.projectId !== 'string') {
      throw new ActionError('invalid-input', 'A policy object with a projectId is required.');
    }
    await deps.store.savePolicy(policy);
    return { ok: true, projectId: policy.projectId };
  },
  'screen.issueContext': async (payload, deps) => {
    const issueId = required(payload, 'issueId');
    const rows = await listVersionsForIssue(sql(), issueId);
    const versions = await Promise.all(
      rows.map(async (row) => ({
        versionId: row.version_id,
        versionName: row.version_name,
        dossier: await deps.store.getDossier(row.version_id),
      })),
    );
    // Observation mode: no verdict shown on the ticket (SPEC §20).
    const projectId = typeof payload.projectId === 'string' ? payload.projectId : '';
    const policy = projectId ? await deps.store.getPolicy(projectId) : null;
    return { issueId, versions, observationMode: Boolean(policy?.observationMode) };
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
    return {
      ok: true,
      action: key,
      result: await runAction(key, payload, await createDeps(context)),
    };
  } catch (error) {
    return refusal(error);
  }
}

/* ---------------------------------------------------------------- router */

const resolver = new Resolver();

for (const key of ACTION_KEYS) {
  resolver.define(key, async (request: { payload?: ForgePayload; context: ForgeContext }) => {
    try {
      return await runAction(key, request.payload ?? {}, await createDeps(request.context));
    } catch (error) {
      return refusal(error);
    }
  });
}

for (const [key, screen] of Object.entries(SCREENS)) {
  resolver.define(key, async (request: { payload?: ForgePayload; context: ForgeContext }) =>
    screen(request.payload ?? {}, await createDeps(request.context)),
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
  const jsmClient = createJsmClient(api.asApp().requestJira as unknown as ForgeRequest, {
    affectedServicesFieldId: SITE_CONFIG.affectedServicesFieldId,
    incidentIssueType: SITE_CONFIG.incidentIssueType,
  });
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
    affectedServicesFieldId: SITE_CONFIG.affectedServicesFieldId,
    clock,
    logger,
  });
}

/** Pipeline collaborators, assembled for one project. */
async function pipelineDeps(projectId: string, cloudId: string | null): Promise<PipelineDeps> {
  await ensureSchema();
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
  // Sans ce rappel, la première invocation interroge `recalc_pending` avant sa
  // création : le trigger lève, l'événement est perdu, aucun recalcul n'est
  // jamais mis en file (constaté en réel sur le site de démo).
  await ensureSchema();
  return onJiraEvent(event, { queue: jobQueue, gate: createFailOpenSqlGate(sql(), logger), clock, logger });
}

/**
 * Purges the expired dossiers of every tracked project (SPEC §15 keeps
 * decisions, waivers and outcomes; `selectSnapshotsToPrune` protects them).
 */
async function pruneAllProjects(): Promise<void> {
  const rows = await listVersions(sql());
  const projectIds = [...new Set(rows.map((row) => row.project_id).filter(Boolean))];
  for (const projectId of projectIds) {
    const report = await pruneSnapshots(sql(), projectId, DEFAULT_RETENTION, clock.now());
    logger.log('info', 'rétention des dossiers', { projectId, ...report });
  }
}

/** `scheduledTrigger` modules: hourly refresh and the 72 h outcome check. */
export async function onScheduled(payload: ScheduledPayload): Promise<RecomputeMessage[]> {
  await ensureSchema();
  // Rétention : une fois par jour, sur tous les projets suivis (docs/RETENTION.md).
  if (scheduledMode(payload) !== 'hourly') {
    await pruneAllProjects();
  }
  const store: ReleaseStore = createStore();
  const versions: ScheduledVersionSource = {
    async listOpenVersions() {
      // Le déclencheur planifié n'a pas de contexte projet : il balaie toutes
      // les versions ouvertes du site (passer le cloudId comme projectId
      // faisait remonter zéro version).
      const rows = await listOpenVersions(sql());
      return rows.map((row) => ({
        versionId: row.version_id,
        versionName: row.version_name,
        projectId: row.project_id,
        released: Boolean(row.version_released),
        computedAt: row.computed_at,
      }));
    },
    async listReleasedVersions(beforeIso: string) {
      const rows = await listReleasedVersions(sql(), beforeIso);
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
    gate: createFailOpenSqlGate(sql(), logger),
    clock,
    logger,
    store,
    versions,
  });
}

/**
 * A queued event arrives wrapped: `@forge/events` delivers an `AsyncEvent`
 * whose `body` is what `queue.push({ body })` carried (R3 §3). Observed live on
 * the demo site: reading the envelope directly yields `versionId: undefined`.
 */
function readMessage(event: unknown): RecomputeMessage {
  const envelope = event as { body?: unknown } | null;
  const candidate = (envelope?.body ?? event) as RecomputeMessage | undefined;
  if (
    !candidate ||
    typeof candidate.versionId !== 'string' ||
    typeof candidate.projectId !== 'string'
  ) {
    throw new Error(
      'Recompute message illisible : projectId et versionId sont requis dans le corps.',
    );
  }
  return candidate;
}

/** `consumer` module: drains one recompute message. */
export async function onMessage(event: unknown): Promise<unknown> {
  const message = readMessage(event);
  const deps = await pipelineDeps(message.projectId, null);
  const recompute: RecomputeFn = async (pipeline, request) => {
    const result = await recomputeRelease(pipeline, request);
    // Le bilan 72 h suit le recalcul : demande explicitement (`reason:
    // 'outcome'`) ou des que la version est publiée (RI-15).
    if (request.reason === 'outcome' || result.snapshot.versionReleased) {
      await recomputeOutcome(pipeline, request);
    }
    return result;
  };
  return runConsumer(message, {
    pipeline: deps,
    recompute,
    logger,
    // Passe finale (SPEC §12) : ce que la fenêtre de regroupement a retenu est
    // rejoué dès la fin du recalcul, pas au balayage horaire.
    trailing: { gate: createFailOpenSqlGate(sql(), logger), clock, logger, sleep },
  });
}

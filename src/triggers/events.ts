/**
 * Jira event trigger (Forge module `trigger`, R3 §1): turns a version, issue or
 * issue-link event into at most one recompute message per version and per
 * minute, published on the recompute queue (`consumer`, R3 §3).
 *
 * Event names, payload shapes and queue API follow docs/research/R3-events-queues.md:
 * `avi:jira:<action>:<entity>`, payload under `event.version` / `event.issue`,
 * publishing through `JobQueue.publish` (R3 §4: `queue.push({ body })` in Forge).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import {
  coalesceRequests,
  shouldRecompute,
} from '../engine/debounce';
import type { Clock, JobQueue, Logger, RecomputeMessage } from '../ports';

/** The nine project-version events (R3 §1.3, S4). Exact spelling. */
export const VERSION_EVENTS = [
  'avi:jira:created:version',
  'avi:jira:updated:version',
  'avi:jira:deleted:version',
  'avi:jira:released:version',
  'avi:jira:unreleased:version',
  'avi:jira:archived:version',
  'avi:jira:unarchived:version',
  'avi:jira:moved:version',
  'avi:jira:merged:version',
] as const;

/**
 * Issue events that can change a release's content. `viewed:issue` and
 * `mentioned:issue` exist (R3 §1.3) but never change a dossier: they are left
 * out on purpose, so they fall through as unrecognised and are only logged.
 */
export const ISSUE_EVENTS = [
  'avi:jira:created:issue',
  'avi:jira:updated:issue',
  'avi:jira:deleted:issue',
  'avi:jira:assigned:issue',
] as const;

/** The two issue-link events (R3 §1.3, S4). */
export const ISSUE_LINK_EVENTS = [
  'avi:jira:created:issuelink',
  'avi:jira:deleted:issuelink',
] as const;

export interface VersionPayload {
  id?: string;
  projectId?: string;
}

export interface IssuePayload {
  id?: string;
  key?: string;
  fields?: {
    project?: { id?: string };
    fixVersions?: { id?: string }[];
  };
  changelog?: {
    items?: { field?: string; fieldId?: string; to?: unknown }[];
  };
}

/**
 * The subset of a Jira event payload the trigger reads. Forge delivers the raw
 * webhook body (R3 §1.2), so every field is optional and guarded.
 */
export interface JiraEventLike {
  eventType?: string;
  selfGenerated?: boolean;
  timestamp?: number;
  version?: VersionPayload;
  mergedVersion?: VersionPayload;
  issue?: IssuePayload;
  sourceProjectId?: string;
  destinationProjectId?: string;
  sourceIssueId?: string;
  destinationIssueId?: string;
}

/** A release that may need a recompute. */
export interface RecomputeTarget {
  projectId: string;
  versionId: string;
}

/**
 * Timestamp store behind the "one recompute per minute" rule (SPEC §12). The
 * Forge SQL adapter implements it on `recalc_pending` (R3 §5); the in-memory
 * version below is for tests and single-invocation fallbacks.
 */
export interface RecomputeGate {
  lastQueuedAt(versionId: string): Promise<string | null>;
  markQueued(versionId: string, at: string): Promise<void>;
  /**
   * Holds back a request that fell inside the window: "regroupé, jamais jeté"
   * (SPEC §12, §16). Implementations coalesce it with the one already held back,
   * with `coalesceRequests`: strongest reason wins, earliest request on a tie.
   */
  deferRequest(request: RecomputeMessage, deferredAt: string): Promise<void>;
  /** The request held back for a version, or null. Read without clearing. */
  deferredRequest(versionId: string): Promise<RecomputeMessage | null>;
  /** Forgets what was held back for a version. Idempotent. */
  clearDeferred(versionId: string): Promise<void>;
  /** Everything held back, oldest first, bounded: the hourly safety net. */
  listDeferred(limit: number): Promise<RecomputeMessage[]>;
}

export function createMemoryGate(): RecomputeGate {
  const stamps = new Map<string, string>();
  const held = new Map<string, RecomputeMessage>();
  return {
    async lastQueuedAt(versionId: string): Promise<string | null> {
      return stamps.get(versionId) ?? null;
    },
    async markQueued(versionId: string, at: string): Promise<void> {
      stamps.set(versionId, at);
    },
    async deferRequest(request: RecomputeMessage, _deferredAt: string): Promise<void> {
      const known = held.get(request.versionId);
      held.set(request.versionId, coalesceRequests(known === undefined ? [] : [known], request)[0]);
    },
    async deferredRequest(versionId: string): Promise<RecomputeMessage | null> {
      return held.get(versionId) ?? null;
    },
    async clearDeferred(versionId: string): Promise<void> {
      held.delete(versionId);
    },
    async listDeferred(limit: number): Promise<RecomputeMessage[]> {
      return [...held.values()]
        .sort((left, right) => (left.requestedAt < right.requestedAt ? -1 : 1))
        .slice(0, Math.max(0, limit));
    },
  };
}

/** Everything needed to publish a due recompute. */
export interface EnqueueDeps {
  queue: JobQueue;
  gate: RecomputeGate;
  clock: Clock;
  logger: Logger;
  /** Overrides the 60 s debounce window (SPEC §12). */
  minIntervalSeconds?: number;
}

/**
 * Borne du filet de sécurité horaire : le balayage ne relit jamais plus de
 * demandes reportées que de versions suivies en pratique (SPEC §12). La porte
 * SQL applique la même borne, d'où une seule constante partagée.
 */
export const MAX_DEFERRED_FLUSH = 50;

export interface TriggerDeps extends EnqueueDeps {
  /**
   * Resolves the versions an issue belongs to. Issue-link payloads carry only
   * issue and project ids (R3 §1.3), so link events are recognised but cannot
   * target a version until this lookup is wired.
   */
  versionsOfIssues?: (issueIds: string[]) => Promise<RecomputeTarget[]>;
}

function isOneOf(names: readonly string[], eventType: string): boolean {
  return names.includes(eventType);
}

function targetOf(version: VersionPayload | undefined): RecomputeTarget | null {
  if (version?.id === undefined || version.projectId === undefined) {
    return null;
  }
  return { projectId: version.projectId, versionId: version.id };
}

function versionTargets(
  event: JiraEventLike,
  deps: TriggerDeps,
): RecomputeTarget[] {
  const target = targetOf(event.version);
  if (target === null) {
    deps.logger.log('debug', 'version event without version id or project id', {
      eventType: event.eventType,
    });
    return [];
  }
  return [target];
}

/** Version ids named by a `fixVersions` changelog entry (R3 §1.3). */
function changelogVersionIds(issue: IssuePayload): string[] {
  const items = issue.changelog?.items ?? [];
  return items
    .filter((item) => item.field === 'fixVersions' || item.fieldId === 'fixVersions')
    .map((item) => item.to)
    .filter((to): to is string => typeof to === 'string' && /^\d+$/.test(to));
}

function issueVersionIds(issue: IssuePayload): string[] {
  const fromFields = (issue.fields?.fixVersions ?? [])
    .map((v) => v.id)
    .filter((id): id is string => id !== undefined);
  return [...new Set([...fromFields, ...changelogVersionIds(issue)])];
}

async function issueTargets(
  event: JiraEventLike,
  deps: TriggerDeps,
): Promise<RecomputeTarget[]> {
  const issue = event.issue;
  const projectId = issue?.fields?.project?.id;
  if (issue === undefined || projectId === undefined) {
    deps.logger.log('debug', 'issue event without project id', {
      eventType: event.eventType,
    });
    return [];
  }
  const versionIds = issueVersionIds(issue);
  if (versionIds.length > 0) {
    return versionIds.map((versionId) => ({ projectId, versionId }));
  }
  // No fix version in the payload: fall back to the lookup, when wired.
  const issueIds = [issue.id].filter((id): id is string => id !== undefined);
  return issueIds.length === 0 || deps.versionsOfIssues === undefined
    ? []
    : deps.versionsOfIssues(issueIds);
}

async function linkTargets(
  event: JiraEventLike,
  deps: TriggerDeps,
): Promise<RecomputeTarget[]> {
  const issueIds = [event.sourceIssueId, event.destinationIssueId].filter(
    (id): id is string => id !== undefined,
  );
  if (issueIds.length === 0) {
    return [];
  }
  if (deps.versionsOfIssues === undefined) {
    deps.logger.log('debug', 'issue-link event without version lookup', {
      eventType: event.eventType,
      issueIds,
    });
    return [];
  }
  return deps.versionsOfIssues(issueIds);
}

async function resolveTargets(
  event: JiraEventLike,
  deps: TriggerDeps,
): Promise<RecomputeTarget[]> {
  const eventType = event.eventType ?? '';
  if (isOneOf(VERSION_EVENTS, eventType)) {
    return versionTargets(event, deps);
  }
  if (isOneOf(ISSUE_EVENTS, eventType)) {
    return issueTargets(event, deps);
  }
  if (isOneOf(ISSUE_LINK_EVENTS, eventType)) {
    return linkTargets(event, deps);
  }
  deps.logger.log('debug', 'ignored unrecognised Jira event', { eventType });
  return [];
}

/**
 * Folds a batch of requests into at most one per version, keeping the strongest
 * reason (SPEC §12). A scheduled run can name the same version twice.
 */
export function coalesceBatch(requests: RecomputeMessage[]): RecomputeMessage[] {
  return requests.reduce<RecomputeMessage[]>(
    (pending, incoming) => coalesceRequests(pending, incoming),
    [],
  );
}

/**
 * Publishes the requests that are due, after coalescing them per version and
 * applying the debounce gate. Shared by the event and scheduled triggers so the
 * "one per minute" rule has a single implementation.
 */
export async function enqueueDue(
  deps: EnqueueDeps,
  requests: RecomputeMessage[],
): Promise<RecomputeMessage[]> {
  const now = deps.clock.now();
  const published: RecomputeMessage[] = [];
  for (const request of coalesceBatch(requests)) {
    const lastQueuedAt = await deps.gate.lastQueuedAt(request.versionId);
    if (!shouldRecompute(lastQueuedAt, now, deps.minIntervalSeconds)) {
      // Regroupé, jamais jeté (SPEC §12) : la demande est conservée puis rejouée
      // par la passe finale du consumer ou, en dernier recours, par le balayage
      // horaire. La jeter laissait le dossier périmé jusqu'à une heure.
      await deps.gate.deferRequest(request, now);
      deps.logger.log('debug', 'recompute deferred, inside the debounce window', {
        versionId: request.versionId,
        reason: request.reason,
        lastQueuedAt,
      });
      continue;
    }
    await deps.queue.publish(request);
    await deps.gate.markQueued(request.versionId, now);
    // La demande en attente pour cette version, s'il y en avait une, vient d'être
    // publiée : sans cet effacement le balayage horaire la republierait indéfiniment.
    await deps.gate.clearDeferred(request.versionId);
    deps.logger.log('debug', 'recompute queued', {
      versionId: request.versionId,
      reason: request.reason,
    });
    published.push(request);
  }
  return published;
}

/**
 * Handler for the `trigger` module. Unknown events are ignored with a `debug`
 * log: a trigger must never throw on a payload it does not understand, or Forge
 * would retry it for 24 h (R3 §3, at-least-once delivery).
 */
export async function onJiraEvent(
  event: JiraEventLike,
  deps: TriggerDeps,
): Promise<RecomputeMessage[]> {
  const targets = await resolveTargets(event, deps);
  if (targets.length === 0) {
    return [];
  }
  const now = deps.clock.now();
  const requests = targets.map((target): RecomputeMessage => ({
    projectId: target.projectId,
    versionId: target.versionId,
    reason: 'event',
    requestedAt: now,
  }));
  return enqueueDue(deps, requests);
}

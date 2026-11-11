/**
 * Scheduled trigger (Forge module `scheduledTrigger`, R3 §2): the hourly
 * refresh of open releases and the 72 h outcome check (SPEC §4 "Bilan",
 * RI-15).
 *
 * R3 §2 is explicit: Forge only offers `fiveMinute | hour | day | week`, so the
 * 72 h check is an `interval: day` module whose handler tests
 * `now - releasedAt >= OUTCOME_WINDOW_HOURS`. Scheduled invocations may be
 * duplicated and are never retried, hence the debounce gate and the
 * "already has an Outcome" test below.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { hoursBetween } from '../signals/context.js';
import { OUTCOME_WINDOW_HOURS, type JiraVersion } from '../types.js';
import type { RecomputeMessage, ReleaseStore } from '../ports.js';
import { enqueueDue, type EnqueueDeps } from './events.js';

/** A release the scheduler may ask a recompute for. */
export interface ScheduledVersion {
  projectId: string;
  versionId: string;
  released: boolean;
  /** ISO 8601 publication instant, known once `avi:jira:released:version` fired. */
  releasedAt?: string;
}

/** Adapts a Jira version to the scheduler shape (SPEC §13 `release_snapshot`). */
export function scheduledVersion(
  version: JiraVersion,
  releasedAt?: string,
): ScheduledVersion {
  return {
    projectId: version.projectId,
    versionId: version.id,
    released: version.released,
    ...(releasedAt !== undefined ? { releasedAt } : {}),
  };
}

/** Read side of the Forge SQL store, implemented by the `src/db` adapter. */
export interface ScheduledVersionSource {
  /** Versions not published yet: refreshed hourly (SPEC §16, waivers expire). */
  listOpenVersions(): Promise<ScheduledVersion[]>;
  /**
   * Versions published at or before `beforeIso`, i.e. older than the outcome
   * window: the candidates for the 72 h check.
   */
  listReleasedVersions(beforeIso: string): Promise<ScheduledVersion[]>;
}

export interface ScheduledDeps extends EnqueueDeps {
  store: Pick<ReleaseStore, 'getOutcome'>;
  versions: ScheduledVersionSource;
}

/** Which schedule fired, derived from the manifest module key (R3 §2). */
export type ScheduledMode = 'hourly' | 'outcome' | 'both';

/** Payload delivered to a scheduled function (R3 §2, S10). */
export interface ScheduledPayload {
  context?: { cloudId?: string; moduleKey?: string };
}

function messageFor(
  version: ScheduledVersion,
  reason: RecomputeMessage['reason'],
  now: string,
): RecomputeMessage {
  return {
    projectId: version.projectId,
    versionId: version.versionId,
    reason,
    requestedAt: now,
  };
}

/** `hourly-refresh` → hourly, `daily-outcome` → outcome, anything else → both. */
export function scheduledMode(payload: ScheduledPayload): ScheduledMode {
  const moduleKey = payload.context?.moduleKey ?? '';
  if (moduleKey.includes('outcome')) {
    return 'outcome';
  }
  if (moduleKey.includes('hourly')) {
    return 'hourly';
  }
  return 'both';
}

async function hourlyRequests(
  deps: ScheduledDeps,
  now: string,
): Promise<RecomputeMessage[]> {
  const open = await deps.versions.listOpenVersions();
  return open
    .filter((version) => !version.released)
    .map((version) => messageFor(version, 'schedule', now));
}

function isOutcomeDue(version: ScheduledVersion, now: string): boolean {
  if (!version.released || version.releasedAt === undefined) {
    return false;
  }
  const hours = hoursBetween(version.releasedAt, now);
  return Number.isFinite(hours) && hours >= OUTCOME_WINDOW_HOURS;
}

async function outcomeRequests(
  deps: ScheduledDeps,
  now: string,
): Promise<RecomputeMessage[]> {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    deps.logger.log('warn', 'scheduled outcome check skipped, bad clock', { now });
    return [];
  }
  const beforeIso = new Date(
    nowMs - OUTCOME_WINDOW_HOURS * 3_600_000,
  ).toISOString();
  const candidates = await deps.versions.listReleasedVersions(beforeIso);
  const requests: RecomputeMessage[] = [];
  for (const version of candidates) {
    if (!isOutcomeDue(version, now)) {
      continue;
    }
    // An Outcome already recorded means the 72 h check ran: never redo it, or
    // duplicated invocations would overwrite the bilan (R3 §2).
    if ((await deps.store.getOutcome(version.versionId)) !== null) {
      continue;
    }
    requests.push(messageFor(version, 'outcome', now));
  }
  return requests;
}

/**
 * Handler for both `scheduledTrigger` modules. Returns the messages actually
 * published; an empty run is normal (nothing open, no bilan due).
 */
export async function onScheduled(
  payload: ScheduledPayload,
  deps: ScheduledDeps,
): Promise<RecomputeMessage[]> {
  const now = deps.clock.now();
  const mode = scheduledMode(payload);
  const requests: RecomputeMessage[] = [];
  if (mode !== 'outcome') {
    requests.push(...(await hourlyRequests(deps, now)));
  }
  if (mode !== 'hourly') {
    requests.push(...(await outcomeRequests(deps, now)));
  }
  if (requests.length === 0) {
    deps.logger.log('debug', 'scheduled recompute, nothing to queue', { mode });
    return [];
  }
  deps.logger.log('debug', 'scheduled recompute', {
    mode,
    candidates: requests.length,
  });
  return enqueueDue(deps, requests);
}

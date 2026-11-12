/**
 * Recompute debounce and coalescing — the pure core of SPEC §12 ("Flux de
 * calcul", step 1) and SPEC §16 ("recalcul regroupé, un seul par minute").
 *
 * Forge gives no deduplication on queues (R3 §5): "at most one recompute per
 * minute and per version" is an app-side rule, implemented here without any
 * clock or I/O. `now` is always injected.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { RecomputeMessage } from '../ports';

/** Minimum gap between two queued recomputes of the same version (SPEC §12). */
export const MIN_RECOMPUTE_INTERVAL_SECONDS = 60;

/**
 * Strongest first. A `manual` request (a user clicking "recompute") must never
 * be downgraded to `event` by a coalesce, and an `event` outranks the hourly
 * `schedule` sweep, which outranks the 72 h `outcome` check.
 */
const REASON_PRIORITY: Record<RecomputeMessage['reason'], number> = {
  manual: 3,
  event: 2,
  schedule: 1,
  outcome: 0,
};

/**
 * True when a new recompute may be queued for a version last queued at
 * `lastQueuedAt`. An unreadable timestamp fails open (recompute) so a bad row
 * can never freeze a dossier; a timestamp in the future fails closed (the
 * debounce window has not elapsed).
 */
export function shouldRecompute(
  lastQueuedAt: string | null,
  now: string,
  minIntervalSeconds: number = MIN_RECOMPUTE_INTERVAL_SECONDS,
): boolean {
  if (lastQueuedAt === null) {
    return true;
  }
  const lastMs = Date.parse(lastQueuedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) {
    return true;
  }
  return nowMs - lastMs >= minIntervalSeconds * 1000;
}

function pickStronger(
  current: RecomputeMessage,
  candidate: RecomputeMessage,
): RecomputeMessage {
  const currentRank = REASON_PRIORITY[current.reason];
  const candidateRank = REASON_PRIORITY[candidate.reason];
  if (candidateRank !== currentRank) {
    return candidateRank > currentRank ? candidate : current;
  }
  // Same reason: keep the earliest request, so the dossier shows when the need
  // first appeared rather than when the last duplicate arrived.
  return candidate.requestedAt < current.requestedAt ? candidate : current;
}

/**
 * Folds `incoming` into the `pending` requests: at most one message per
 * version, carrying the strongest reason of the merged ones. Order follows the
 * first appearance of each version, and the inputs are never mutated.
 */
export function coalesceRequests(
  pending: RecomputeMessage[],
  incoming: RecomputeMessage,
): RecomputeMessage[] {
  const byVersion = new Map<string, RecomputeMessage>();
  for (const message of [...pending, incoming]) {
    const current = byVersion.get(message.versionId);
    byVersion.set(
      message.versionId,
      current === undefined ? message : pickStronger(current, message),
    );
  }
  return [...byVersion.values()];
}

/* ------------------------------------------------- trailing pass (SPEC §12) */

/** A recompute request held back by the window, as the gate stores it. */
export interface DeferredRequest {
  reason: RecomputeMessage['reason'];
  requestedAt: string;
}

/**
 * What the trailing pass must do once a recompute of the version has finished:
 * `none` (nothing deferred), `clear` (the deferral predates the collection that
 * just ended, so it is already accounted for) or `run` (recompute again, after
 * `waitMs` so the "one per minute" rule still holds).
 */
export type TrailingAction = 'none' | 'clear' | 'run';

export interface TrailingDecision {
  action: TrailingAction;
  waitMs: number;
}

/**
 * "Regroupé" never means "jeté" (SPEC §12, §16): a change that arrived while a
 * recompute was collecting must still be seen. `collectStartedAt` is the instant
 * the finished recompute started reading Jira — a deferral at or before it is
 * stale and only needs clearing.
 *
 * Unreadable timestamps fail open (`run`, no wait), exactly like
 * `shouldRecompute`: a bad row must never freeze a dossier. A timestamp in the
 * future (clock skew) bounds the wait to the window.
 */
export function trailingPass(
  lastQueuedAt: string | null,
  deferred: DeferredRequest | null,
  collectStartedAt: string,
  now: string,
  minIntervalSeconds: number = MIN_RECOMPUTE_INTERVAL_SECONDS,
): TrailingDecision {
  if (deferred === null) {
    return { action: 'none', waitMs: 0 };
  }
  const deferredMs = Date.parse(deferred.requestedAt);
  if (Number.isNaN(deferredMs)) {
    return { action: 'run', waitMs: 0 };
  }
  const collectMs = Date.parse(collectStartedAt);
  if (!Number.isNaN(collectMs) && deferredMs <= collectMs) {
    return { action: 'clear', waitMs: 0 };
  }
  const windowMs = minIntervalSeconds * 1000;
  const lastMs = lastQueuedAt === null ? Number.NaN : Date.parse(lastQueuedAt);
  const nowMs = Date.parse(now);
  if (Number.isNaN(lastMs) || Number.isNaN(nowMs)) {
    return { action: 'run', waitMs: 0 };
  }
  const waitMs = Math.max(0, Math.min(lastMs + windowMs - nowMs, windowMs));
  return { action: 'run', waitMs };
}

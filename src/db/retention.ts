/**
 * Retention of the release dossiers (SPEC §15, R4 §3).
 *
 * Why this module exists: one recompute writes one dossier, and a recompute is
 * triggered by every Jira event (issue edited, link created, version touched) —
 * **31 dossiers were written in a single day** on the demo site. Forge SQL
 * bills storage per GB-hour and caps an installation at **1 Gio** (R4 §3), so
 * without a retention rule the `signal` table grows until the quota is hit and
 * every write fails.
 *
 * Two hard rules shape the code:
 * - **Traceability is never deleted** (SPEC §15): a dossier attached to a human
 *   decision, and the last dossier of every version (the one a `outcome` /
 *   bilan is read against), are kept forever. Waivers, decisions, outcomes,
 *   policies and the service map are **never** touched here — waivers are
 *   *closed*, not deleted.
 * - **Every query is bounded** (R4 §3: 5 s per SELECT, 4 MiB per response):
 *   the candidate read has a hard `LIMIT` through `sqlLimit`, and deletes go
 *   out in batches of `PRUNE_BATCH_SIZE` ids.
 *
 * The rule itself (`selectSnapshotsToPrune`) is **pure**: no Forge import, no
 * I/O, no real clock — `now` is injected, exactly like `src/db/queries.ts`
 * takes its `SqlClient`. `pruneSnapshots` is the thin adapter around it.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { SqlClient } from './sql-client';
import { sqlLimit } from './sql-client';
import { fromSqlTimestamp } from './rows';

/* --------------------------------------------------------------- policy */

/** What the operator tunes; see `docs/RETENTION.md`. */
export interface RetentionPolicy {
  /** Dossiers kept per version, newest first (the diff history RI-14 needs). */
  keepPerVersion: number;
  /** Age (days) beyond which only one dossier per calendar day is kept. */
  keepDailyAfterDays: number;
  /** Age (days) beyond which a dossier is deleted — unless protected. */
  horizonDays: number;
}

/**
 * Defaults, sized from the observed demo rhythm (31 dossiers/day, one project):
 * - `keepPerVersion: 20` — a full working day of recomputes plus margin, so the
 *   "what changed since yesterday" diff always has a predecessor;
 * - `keepDailyAfterDays: 14` — two weeks of per-dossier detail, then daily dots;
 * - `horizonDays: 180` — six months of history, long enough for a post-mortem,
 *   short enough to stay far below the 1 Gio cap (a dossier is a few KiB).
 */
export const DEFAULT_RETENTION: RetentionPolicy = {
  keepPerVersion: 20,
  keepDailyAfterDays: 14,
  horizonDays: 180,
};

/** Rows read per run: three tiny columns, far below the 4 MiB response cap. */
export const MAX_RETENTION_CANDIDATES = 1000;

/** Snapshot ids protected per run (decisions + caller-supplied). */
export const MAX_PROTECTED_ROWS = 1000;

/** Ids deleted per SQL statement; keeps every DELETE inside the 10 s budget. */
export const PRUNE_BATCH_SIZE = 50;

/* ------------------------------------------------------------- pure rule */

/** A dossier as the retention rule sees it — nothing more is needed. */
export interface RetentionCandidate {
  id: string;
  versionId: string;
  /** Computation date. ISO-8601 or the Forge `YYYY-MM-DD HH:MM:SS.fff` form. */
  computedAt: string;
  /** Never deleted (decision, bilan, …). Also settable via `protectedIds`. */
  protected?: boolean;
}

/** A candidate whose date could be read: the only ones the rule may prune. */
interface DatedCandidate extends RetentionCandidate {
  timestamp: number;
  /** UTC calendar day, `YYYY-MM-DD`. */
  day: string;
}

/** Forge returns TIMESTAMP as UTC wall-clock; an ISO value keeps its offset. */
function toIsoTimestamp(value: unknown): string {
  if (typeof value !== 'string') return '';
  const raw = value.trim();
  if (raw.length === 0) return '';
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
  }
  return fromSqlTimestamp(raw);
}

/** `null` when the date is unreadable: an undatable dossier is never deleted. */
function parseCandidate(candidate: RetentionCandidate): DatedCandidate | null {
  const iso = toIsoTimestamp(candidate.computedAt);
  const timestamp = iso.length > 0 ? Date.parse(iso) : NaN;
  if (!Number.isFinite(timestamp)) return null;
  return { ...candidate, timestamp, day: iso.slice(0, 10) };
}

const MS_PER_DAY = 86_400_000;

function ageInDays(timestamp: number, nowMs: number): number {
  return Math.max(0, (nowMs - timestamp) / MS_PER_DAY);
}

/** Newest first, ties broken by id: a deterministic order, run after run. */
function newestFirst(left: DatedCandidate, right: DatedCandidate): number {
  if (left.timestamp !== right.timestamp) return right.timestamp - left.timestamp;
  return left.id.localeCompare(right.id);
}

function groupByVersion(candidates: readonly DatedCandidate[]): DatedCandidate[][] {
  const groups = new Map<string, DatedCandidate[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.versionId);
    if (group) group.push(candidate);
    else groups.set(candidate.versionId, [candidate]);
  }
  return [...groups.values()].map((group) => group.sort(newestFirst));
}

/** A policy coming from a settings row can be nonsense; clamp it, never throw. */
export function normalizePolicy(policy: RetentionPolicy): RetentionPolicy {
  const int = (value: number, fallback: number): number =>
    Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : fallback;
  return {
    keepPerVersion: int(policy.keepPerVersion, DEFAULT_RETENTION.keepPerVersion),
    keepDailyAfterDays: int(policy.keepDailyAfterDays, DEFAULT_RETENTION.keepDailyAfterDays),
    horizonDays: int(policy.horizonDays, DEFAULT_RETENTION.horizonDays),
  };
}

/**
 * One version's dossiers, newest first (`index === 0` is the last one).
 * Precedence, documented in `docs/RETENTION.md`:
 * protected → last dossier → horizon → recent quota → one per calendar day.
 */
function pruneOneVersion(
  group: readonly DatedCandidate[],
  policy: RetentionPolicy,
  nowMs: number,
  isProtected: (candidate: DatedCandidate) => boolean,
): DatedCandidate[] {
  const pruned: DatedCandidate[] = [];
  const keptDays = new Set<string>();
  const keep = (candidate: DatedCandidate): void => {
    keptDays.add(candidate.day);
  };
  for (let index = 0; index < group.length; index += 1) {
    const candidate = group[index];
    if (isProtected(candidate) || index === 0) {
      keep(candidate);
      continue;
    }
    const age = ageInDays(candidate.timestamp, nowMs);
    if (age > policy.horizonDays) {
      pruned.push(candidate);
    } else if (index < policy.keepPerVersion) {
      keep(candidate);
    } else if (age <= policy.keepDailyAfterDays || keptDays.has(candidate.day)) {
      pruned.push(candidate);
    } else {
      keep(candidate);
    }
  }
  return pruned;
}

/**
 * The retention rule, pure: returns the ids of the dossiers to delete.
 *
 * Never deleted: a protected dossier (decision / bilan / caller-supplied), the
 * **last** dossier of each version, an undatable dossier, and anything when
 * `now` cannot be parsed (a broken clock must not delete history).
 *
 * The result is ordered oldest-first (id as tie-break): deletes start with the
 * least useful rows and the order is stable across runs.
 */
export function selectSnapshotsToPrune(
  snapshots: readonly RetentionCandidate[],
  policy: RetentionPolicy,
  now: string,
  protectedSnapshotIds: ReadonlySet<string> = new Set<string>(),
): string[] {
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) return [];
  const rules = normalizePolicy(policy);
  const dated = snapshots
    .map(parseCandidate)
    .filter((candidate): candidate is DatedCandidate => candidate !== null);
  const isProtected = (candidate: DatedCandidate): boolean =>
    candidate.protected === true || protectedSnapshotIds.has(candidate.id);
  const pruned = groupByVersion(dated).flatMap((group) =>
    pruneOneVersion(group, rules, nowMs, isProtected),
  );
  return pruned
    .sort((left, right) =>
      left.timestamp !== right.timestamp
        ? left.timestamp - right.timestamp
        : left.id.localeCompare(right.id),
    )
    .map((candidate) => candidate.id);
}

/* --------------------------------------------------------------- adapter */

/** Row shape of the candidate read: three columns, nothing else. */
interface CandidateRow {
  id: string;
  version_id: string;
  computed_at: string;
}

interface ProtectedRow {
  snapshot_id: string;
}

/** What one run did; `pruned` counts the dossiers a DELETE was issued for. */
export interface PruneReport {
  scanned: number;
  pruned: number;
  protected: number;
  batches: number;
  durationMs: number;
}

export interface PruneOptions {
  /** Rows scanned per run (default `MAX_RETENTION_CANDIDATES`). */
  maxCandidates?: number;
  /** Ids deleted per statement (default `PRUNE_BATCH_SIZE`). */
  batchSize?: number;
  /** Extra ids to protect, on top of the ones read from `decision`. */
  protectedSnapshotIds?: ReadonlySet<string>;
  /** Millisecond clock, injectable so tests stay deterministic. */
  clock?: () => number;
}

/** Bounded read of the project's dossiers, newest first. */
async function readCandidates(
  sql: SqlClient,
  projectId: string,
  maxCandidates?: number,
): Promise<RetentionCandidate[]> {
  const limit = sqlLimit(maxCandidates ?? MAX_RETENTION_CANDIDATES, MAX_RETENTION_CANDIDATES);
  const rows = await sql.query<CandidateRow>(
    `SELECT id, version_id, computed_at
       FROM release_snapshot
      WHERE project_id = ?
      ORDER BY computed_at DESC
      LIMIT ${limit}`,
    [projectId],
  );
  return rows.map((row) => ({
    id: row.id,
    versionId: row.version_id,
    computedAt: row.computed_at,
  }));
}

/**
 * Snapshot ids a human decision points at (SPEC §15: a decision is never
 * orphaned). `decision` has no `project_id`, hence the join on the dossier.
 * Outcomes need no query: they are per-version, and the last dossier of every
 * version is kept by the rule itself.
 */
async function readProtectedIds(
  sql: SqlClient,
  projectId: string,
  extra?: ReadonlySet<string>,
): Promise<Set<string>> {
  const ids = new Set<string>(extra ? [...extra] : []);
  const rows = await sql.query<ProtectedRow>(
    `SELECT DISTINCT d.snapshot_id
       FROM decision d
       JOIN release_snapshot r ON r.id = d.snapshot_id
      WHERE r.project_id = ?
      LIMIT ${sqlLimit(MAX_PROTECTED_ROWS)}`,
    [projectId],
  );
  for (const row of rows) {
    if (typeof row.snapshot_id === 'string' && row.snapshot_id.length > 0) {
      ids.add(row.snapshot_id);
    }
  }
  return ids;
}

/** Batch size, clamped to `PRUNE_BATCH_SIZE`: a caller cannot unbound a DELETE. */
function batchSizeOf(batchSize?: number): number {
  const value = Number(batchSize ?? PRUNE_BATCH_SIZE);
  if (!Number.isFinite(value)) return PRUNE_BATCH_SIZE;
  return Math.max(1, Math.min(Math.trunc(value), PRUNE_BATCH_SIZE));
}

/**
 * Deletes `signal` **before** `release_snapshot`, batch by batch: Forge SQL has
 * no foreign keys and no cascading delete (R4 §3), so the integrity lives here.
 * Deleting the parent first would leave orphan signals behind on a crash.
 * Never a whole-table delete, never a table other than those two.
 */
async function deleteInBatches(
  sql: SqlClient,
  ids: readonly string[],
  batchSize?: number,
): Promise<number> {
  const size = batchSizeOf(batchSize);
  let batches = 0;
  for (let start = 0; start < ids.length; start += size) {
    const chunk = ids.slice(start, start + size);
    const placeholders = chunk.map(() => '?').join(', ');
    await sql.execute(`DELETE FROM signal WHERE snapshot_id IN (${placeholders})`, chunk);
    await sql.execute(`DELETE FROM release_snapshot WHERE id IN (${placeholders})`, chunk);
    batches += 1;
  }
  return batches;
}

/**
 * Applies the retention rule to one project: reads the candidates, computes the
 * list with the pure rule, deletes it in bounded batches, reports what it did.
 * Idempotent and replayable — without transactions (R4 §1.5) a run that dies
 * mid-way simply leaves the next run to finish.
 */
export async function pruneSnapshots(
  sql: SqlClient,
  projectId: string,
  policy: RetentionPolicy = DEFAULT_RETENTION,
  now: string = new Date().toISOString(),
  options: PruneOptions = {},
): Promise<PruneReport> {
  const clock = options.clock ?? Date.now;
  const startedAt = clock();
  const candidates = await readCandidates(sql, projectId, options.maxCandidates);
  const protectedIds = await readProtectedIds(sql, projectId, options.protectedSnapshotIds);
  const pruned = selectSnapshotsToPrune(candidates, policy, now, protectedIds);
  const batches = await deleteInBatches(sql, pruned, options.batchSize);
  return {
    scanned: candidates.length,
    pruned: pruned.length,
    protected: candidates.filter((candidate) => protectedIds.has(candidate.id)).length,
    batches,
    durationMs: Math.max(0, clock() - startedAt),
  };
}

/**
 * One technical line for the operator logs, e.g.
 * `retention prune: scanned=31 pruned=12 protected=2 batches=1 durationMs=48`.
 *
 * **No i18n on purpose**: this is a log line, not a user-facing string, and
 * `src/i18n/index.ts` is a shared file this module may not edit
 * (`docs/CONVENTIONS.md` §1 and §3). The `locale` argument is accepted for
 * call-site symmetry with the screens and ignored.
 */
export function formatRetentionReport(report: PruneReport, _locale?: string): string {
  return (
    `retention prune: scanned=${report.scanned} pruned=${report.pruned} ` +
    `protected=${report.protected} batches=${report.batches} ` +
    `durationMs=${report.durationMs}`
  );
}

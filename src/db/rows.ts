/**
 * SQL row shapes and scalar value conversions for Forge SQL.
 *
 * Two Forge quirks live here, once for the whole `src/db` layer (R4 §1.2, §3):
 * - **BOOLEAN comes back as 0/1**, TIMESTAMP as `YYYY-MM-DD HH:MM:SS[.fff]`,
 *   TEXT/JSON as `string`. Every read is normalised, every write formatted.
 * - **A row can be corrupted** (hand-edited TEXT, old schema, partial write).
 *   No parser here throws: each one takes a documented fallback, because one
 *   bad column must not blank the dossier screen (R4 §6.3).
 *
 * No Forge import: this module is pure and testable outside a runtime.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { MessageRef } from '../types';
import type { TableName } from './schema';

/* ------------------------------------------------------------------ rows */

export interface ReleaseSnapshotRow {
  id: string;
  project_id: string;
  project_key: string;
  version_id: string;
  version_name: string;
  version_released: number | boolean;
  computed_at: string;
  verdict: string;
  confidence: string;
  coverage_json: string | null;
  counts_json: string | null;
  narrative: string | null;
  narrative_verified: number | boolean;
  narrative_rejections_json: string | null;
  graph_cached_at: string | null;
  previous_snapshot_id: string | null;
}

export interface SignalRow {
  id: string;
  snapshot_id: string;
  code: string;
  severity: string;
  status: string;
  subject_type: string;
  subject_id: string;
  finding_json: string | null;
  evidence_json: string | null;
  detected_at: string;
  first_seen_at: string;
  waiver_id: string | null;
}

export interface WaiverRow {
  id: string;
  version_id: string;
  signal_code: string;
  subject_type: string;
  subject_id: string;
  granted_by: string;
  reason: string;
  granted_at: string;
  expires_at: string;
  closed_at: string | null;
  closed_reason: string | null;
}

export interface DecisionRow {
  id: string;
  version_id: string;
  snapshot_id: string;
  decided_by: string;
  decided_at: string;
  decision: string;
  verdict_at_decision: string;
  note: string | null;
}

export interface OutcomeRow {
  version_id: string;
  checked_at: string;
  incidents_json: string | null;
  rollback: number | boolean;
  notes: string | null;
}

export interface PolicyRow {
  project_id: string;
  rules_json: string | null;
}

export interface ServiceMapRow {
  project_id: string;
  service_id: string;
  service_name: string;
  jira_component: string | null;
  compass_component_id: string | null;
  jsm_service: string | null;
}

/* --------------------------------------------------------------- columns */

const SNAPSHOT_COLUMNS = [
  'id',
  'project_id',
  'project_key',
  'version_id',
  'version_name',
  'version_released',
  'computed_at',
  'verdict',
  'confidence',
  'coverage_json',
  'counts_json',
  'narrative',
  'narrative_verified',
  'narrative_rejections_json',
  'graph_cached_at',
  'previous_snapshot_id',
] as const satisfies readonly (keyof ReleaseSnapshotRow)[];

const SIGNAL_COLUMNS = [
  'id',
  'snapshot_id',
  'code',
  'severity',
  'status',
  'subject_type',
  'subject_id',
  'finding_json',
  'evidence_json',
  'detected_at',
  'first_seen_at',
  'waiver_id',
] as const satisfies readonly (keyof SignalRow)[];

const WAIVER_COLUMNS = [
  'id',
  'version_id',
  'signal_code',
  'subject_type',
  'subject_id',
  'granted_by',
  'reason',
  'granted_at',
  'expires_at',
  'closed_at',
  'closed_reason',
] as const satisfies readonly (keyof WaiverRow)[];

const DECISION_COLUMNS = [
  'id',
  'version_id',
  'snapshot_id',
  'decided_by',
  'decided_at',
  'decision',
  'verdict_at_decision',
  'note',
] as const satisfies readonly (keyof DecisionRow)[];

const OUTCOME_COLUMNS = [
  'version_id',
  'checked_at',
  'incidents_json',
  'rollback',
  'notes',
] as const satisfies readonly (keyof OutcomeRow)[];

const POLICY_COLUMNS = ['project_id', 'rules_json'] as const satisfies readonly (keyof PolicyRow)[];

/** The collection cached with the dossier (SPEC §12). */
export interface CollectionRow {
  version_id: string;
  collected_at: string;
  payload_json: string | null;
}

const COLLECTION_COLUMNS = [
  'version_id',
  'collected_at',
  'payload_json',
] as const satisfies readonly (keyof CollectionRow)[];

const SERVICE_MAP_COLUMNS = [
  'project_id',
  'service_id',
  'service_name',
  'jira_component',
  'compass_component_id',
  'jsm_service',
] as const satisfies readonly (keyof ServiceMapRow)[];

/**
 * Column list per table, typed against its row interface: a column renamed in
 * one place breaks the build instead of silently returning `undefined`.
 */
export const TABLE_COLUMNS: Record<TableName, readonly string[]> = {
  release_snapshot: SNAPSHOT_COLUMNS,
  signal: SIGNAL_COLUMNS,
  waiver: WAIVER_COLUMNS,
  decision: DECISION_COLUMNS,
  outcome: OUTCOME_COLUMNS,
  policy: POLICY_COLUMNS,
  service_map: SERVICE_MAP_COLUMNS,
  collection: COLLECTION_COLUMNS,
};

/** `SELECT` list for a table, e.g. `id, project_id, …`. */
export function selectList(table: TableName): string {
  return TABLE_COLUMNS[table].join(', ');
}

/* ------------------------------------------------------------ primitives */

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/** Serialises a JSON column; a value that cannot be serialised becomes 'null'. */
export function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value) ?? 'null';
  } catch {
    return 'null';
  }
}

/**
 * Reads a JSON column. `accept` rejects a payload of the wrong shape, so a
 * syntactically valid but structurally wrong value still yields `fallback`.
 */
export function parseJson<T>(
  raw: unknown,
  fallback: T,
  accept: (value: unknown) => boolean = () => true,
): T {
  if (typeof raw !== 'string' || raw.length === 0) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return accept(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Parsed value of a JSON column; `null` when the TEXT is unusable. */
export function jsonValue(raw: unknown): unknown {
  return parseJson<unknown>(raw, null);
}

/** Forge returns BOOLEAN as 0/1; a driver may hand back a real boolean. */
export function fromSqlBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (value === '1' || value === 'true') return true;
  if (value === '0' || value === 'false') return false;
  return fallback;
}

export function toSqlBoolean(value: boolean): number {
  return value ? 1 : 0;
}

/** Validates an enum column; anything unknown returns the documented fallback. */
export function parseEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** ISO-8601 → `YYYY-MM-DD HH:MM:SS.fff`, the documented INSERT format. */
export function toSqlTimestamp(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().replace('T', ' ').slice(0, 23);
}

function padFraction(time: string): string {
  const [clock, fraction = ''] = time.split('.');
  return `${clock}.${(fraction + '000').slice(0, 3)}`;
}

/** `YYYY-MM-DD HH:MM:SS[.fff]` → ISO-8601 UTC; '' when unreadable. */
export function fromSqlTimestamp(value: unknown): string {
  if (typeof value !== 'string') return '';
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)/.exec(value);
  if (!match) return '';
  return `${match[1]}T${padFraction(match[2])}Z`;
}

export function fromSqlTimestampOrNull(value: unknown): string | null {
  const iso = fromSqlTimestamp(value);
  return iso.length > 0 ? iso : null;
}

export function parseStringList(value: unknown): string[] {
  return asArray(value).filter((item): item is string => typeof item === 'string');
}

export function parseMessageRef(value: unknown, fallback: MessageRef): MessageRef {
  if (!isObject(value) || typeof value.key !== 'string') return fallback;
  const params = isObject(value.params)
    ? Object.fromEntries(
        Object.entries(value.params).filter(
          (entry): entry is [string, string | number] =>
            typeof entry[1] === 'string' || typeof entry[1] === 'number',
        ),
      )
    : undefined;
  return params ? { key: value.key, params } : { key: value.key };
}

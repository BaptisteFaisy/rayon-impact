/**
 * Pure conversions between domain types (`src/types.ts`) and SQL rows.
 *
 * Row shapes and scalar conversions live in `rows.ts`; this module owns the
 * domain-level parsing: which enum values are legal, what a corrupted
 * `coverage_json` becomes, how the service map is normalised.
 *
 * A read never throws: every parser falls back to a documented default, because
 * a single bad TEXT column must not blank the dossier screen (R4 §6.3).
 *
 * No Forge import here: pure and testable outside a runtime.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type {
  Confidence,
  Coverage,
  Decision,
  DecisionKind,
  Evidence,
  MessageRef,
  Outcome,
  OutcomeIncident,
  SeverityCounts,
  Signal,
  SignalCode,
  SignalStatus,
  Snapshot,
  SourceStatus,
  SubjectType,
  Verdict,
  Waiver,
} from '../types.js';
import { SEVERITY_ORDER } from '../types.js';
import { listSignalCodes } from '../signals/registry.js';
import type {
  DecisionRow,
  OutcomeRow,
  ReleaseSnapshotRow,
  SignalRow,
  WaiverRow,
} from './rows.js';
import {
  asArray,
  fromSqlBoolean,
  fromSqlTimestamp,
  fromSqlTimestampOrNull,
  isObject,
  jsonText,
  jsonValue,
  numberOrZero,
  optionalText,
  parseEnum,
  parseJson,
  parseMessageRef,
  parseStringList,
  text,
  toSqlBoolean,
  toSqlTimestamp,
} from './rows.js';

/** The scalar helpers are part of the mapping surface: one import for callers. */
export {
  fromSqlBoolean,
  fromSqlTimestamp,
  jsonText,
  parseEnum,
  parseJson,
  toSqlBoolean,
  toSqlTimestamp,
} from './rows.js';
export type { CollectionRow, DecisionRow, OutcomeRow, PolicyRow, ReleaseSnapshotRow, ServiceMapRow, SignalRow, WaiverRow } from './rows.js';

/* -------------------------------------------------------------- defaults */

/** Documented fallback of a corrupted `coverage_json`: nothing was measured. */
export const DEFAULT_COVERAGE: Coverage = {
  issueCount: 0,
  issuesWithCode: 0,
  issuesWithService: 0,
  codeRatio: 0,
  serviceRatio: 0,
  sources: [],
  sampledMinorSignals: false,
  notes: [],
};

/** Documented fallback of a corrupted `counts_json`: no signal counted. */
export const DEFAULT_COUNTS: SeverityCounts = { blocking: 0, major: 0, minor: 0, info: 0 };

const VERDICTS: readonly Verdict[] = ['go', 'conditional-go', 'no-go', 'not-applicable'];
const CONFIDENCES: readonly Confidence[] = ['high', 'medium', 'low'];
const SIGNAL_STATUSES: readonly SignalStatus[] = ['active', 'waived', 'cleared'];
const SUBJECT_TYPES: readonly SubjectType[] = [
  'issue',
  'version',
  'service',
  'incident',
  'page',
  'pull-request',
  'build',
  'commit',
  'team',
];
const DECISION_KINDS: readonly DecisionKind[] = ['ship', 'hold', 'delay'];
const SOURCE_STATES = ['ok', 'partial', 'empty', 'unavailable'] as const;

/** A row whose code is unreadable falls back to the first catalogue entry. */
const FALLBACK_CODE: SignalCode = 'COMP-01';

/* --------------------------------------------------- domain-level parsers */

function parseMessageRefList(value: unknown): MessageRef[] {
  return asArray(value).flatMap((item) => {
    const ref = parseMessageRef(item, { key: '' });
    return ref.key.length > 0 ? [ref] : [];
  });
}

/** Evidence without a label is dropped: a proof nobody can name is no proof. */
function parseEvidenceList(value: unknown): Evidence[] {
  return asArray(value).flatMap((item) => {
    if (!isObject(item)) return [];
    const label = parseMessageRef(item.label, { key: '' });
    if (label.key.length === 0 || typeof item.subjectId !== 'string') return [];
    const evidence: Evidence = {
      subjectType: parseEnum(item.subjectType, SUBJECT_TYPES, 'issue'),
      subjectId: item.subjectId,
      label,
    };
    const url = optionalText(item.url);
    if (url) evidence.url = url;
    if (item.restricted === true) evidence.restricted = true;
    return [evidence];
  });
}

function parseCounts(raw: unknown): SeverityCounts {
  const parsed = parseJson<Record<string, unknown>>(raw, {}, isObject);
  const counts: SeverityCounts = { ...DEFAULT_COUNTS };
  for (const severity of SEVERITY_ORDER) {
    const value = parsed[severity];
    if (typeof value === 'number' && Number.isFinite(value)) counts[severity] = value;
  }
  return counts;
}

function parseSources(value: unknown): SourceStatus[] {
  return asArray(value).flatMap((item) => {
    if (!isObject(item) || typeof item.source !== 'string') return [];
    const status: SourceStatus = {
      source: item.source as SourceStatus['source'],
      state: parseEnum(item.state, SOURCE_STATES, 'unavailable'),
    };
    const detail = isObject(item.detail) ? parseMessageRef(item.detail, { key: '' }) : null;
    if (detail && detail.key.length > 0) status.detail = detail;
    return [status];
  });
}

function parseCoverage(raw: unknown): Coverage {
  const parsed = parseJson<Record<string, unknown>>(raw, {}, isObject);
  return {
    issueCount: numberOrZero(parsed.issueCount),
    issuesWithCode: numberOrZero(parsed.issuesWithCode),
    issuesWithService: numberOrZero(parsed.issuesWithService),
    codeRatio: numberOrZero(parsed.codeRatio),
    serviceRatio: numberOrZero(parsed.serviceRatio),
    sources: parseSources(parsed.sources),
    sampledMinorSignals: parsed.sampledMinorSignals === true,
    notes: parseMessageRefList(parsed.notes),
  };
}

function parseIncidents(value: unknown): OutcomeIncident[] {
  return asArray(value).flatMap((item) => {
    if (!isObject(item) || typeof item.key !== 'string') return [];
    const incident: OutcomeIncident = {
      key: item.key,
      severity: parseEnum(item.severity, SEVERITY_ORDER, 'info'),
    };
    if (typeof item.resolvedAfterMinutes === 'number') {
      incident.resolvedAfterMinutes = item.resolvedAfterMinutes;
    }
    const url = optionalText(item.url);
    if (url) incident.url = url;
    return [incident];
  });
}

/* -------------------------------------------------------------- snapshot */

export function snapshotToRow(snapshot: Snapshot): ReleaseSnapshotRow {
  return {
    id: snapshot.id,
    project_id: snapshot.projectId,
    project_key: snapshot.projectKey,
    version_id: snapshot.versionId,
    version_name: snapshot.versionName,
    version_released: toSqlBoolean(snapshot.versionReleased),
    computed_at: toSqlTimestamp(snapshot.computedAt) ?? '',
    verdict: snapshot.verdict,
    confidence: snapshot.confidence,
    coverage_json: jsonText(snapshot.coverage),
    counts_json: jsonText(snapshot.counts),
    narrative: snapshot.narrative,
    narrative_verified: toSqlBoolean(snapshot.narrativeVerified),
    narrative_rejections_json: jsonText(snapshot.narrativeRejections),
    graph_cached_at: toSqlTimestamp(snapshot.graphCachedAt),
    previous_snapshot_id: snapshot.previousSnapshotId,
  };
}

export function rowToSnapshot(row: ReleaseSnapshotRow): Snapshot {
  return {
    id: text(row.id),
    projectId: text(row.project_id),
    projectKey: text(row.project_key),
    versionId: text(row.version_id),
    versionName: text(row.version_name),
    versionReleased: fromSqlBoolean(row.version_released),
    computedAt: fromSqlTimestamp(row.computed_at),
    verdict: parseEnum(row.verdict, VERDICTS, 'not-applicable'),
    confidence: parseEnum(row.confidence, CONFIDENCES, 'low'),
    coverage: parseCoverage(row.coverage_json),
    counts: parseCounts(row.counts_json),
    narrative: text(row.narrative),
    narrativeVerified: fromSqlBoolean(row.narrative_verified),
    narrativeRejections: parseStringList(jsonValue(row.narrative_rejections_json)),
    graphCachedAt: fromSqlTimestampOrNull(row.graph_cached_at),
    previousSnapshotId: optionalText(row.previous_snapshot_id) ?? null,
  };
}

/* ---------------------------------------------------------------- signal */

/** `signal.finding` key of a code, as named in docs/CONVENTIONS.md §3. */
export function findingKeyFor(code: SignalCode): string {
  return `signal.${code.replace('-', '').toLowerCase()}.finding`;
}

/**
 * `snapshotId` is a parameter, not a field of `Signal`: a signal carries its
 * identity and proof, the snapshot is the writing context the repo provides.
 */
export function signalToRow(signal: Signal, snapshotId: string): SignalRow {
  return {
    id: signal.id,
    snapshot_id: snapshotId,
    code: signal.code,
    severity: signal.severity,
    status: signal.status,
    subject_type: signal.subjectType,
    subject_id: signal.subjectId,
    finding_json: jsonText(signal.finding),
    evidence_json: jsonText(signal.evidence),
    detected_at: toSqlTimestamp(signal.detectedAt) ?? '',
    first_seen_at: toSqlTimestamp(signal.firstSeenAt) ?? '',
    waiver_id: signal.waiverId ?? null,
  };
}

export function rowToSignal(row: SignalRow): Signal {
  const code = parseEnum(row.code, listSignalCodes(), FALLBACK_CODE);
  const signal: Signal = {
    id: text(row.id),
    code,
    severity: parseEnum(row.severity, SEVERITY_ORDER, 'info'),
    status: parseEnum(row.status, SIGNAL_STATUSES, 'active'),
    subjectType: parseEnum(row.subject_type, SUBJECT_TYPES, 'issue'),
    subjectId: text(row.subject_id),
    finding: parseMessageRef(jsonValue(row.finding_json), {
      key: findingKeyFor(code),
      params: {},
    }),
    evidence: parseEvidenceList(jsonValue(row.evidence_json)),
    detectedAt: fromSqlTimestamp(row.detected_at),
    firstSeenAt: fromSqlTimestamp(row.first_seen_at),
  };
  const waiverId = optionalText(row.waiver_id);
  if (waiverId) signal.waiverId = waiverId;
  return signal;
}

/* ---------------------------------------------------------------- waiver */

export function waiverToRow(waiver: Waiver): WaiverRow {
  return {
    id: waiver.id,
    version_id: waiver.versionId,
    signal_code: waiver.signalCode,
    subject_type: waiver.subjectType,
    subject_id: waiver.subjectId,
    granted_by: waiver.grantedBy,
    reason: waiver.reason,
    granted_at: toSqlTimestamp(waiver.grantedAt) ?? '',
    expires_at: toSqlTimestamp(waiver.expiresAt) ?? '',
    closed_at: toSqlTimestamp(waiver.closedAt),
    closed_reason: waiver.closedReason ?? null,
  };
}

export function rowToWaiver(row: WaiverRow): Waiver {
  const waiver: Waiver = {
    id: text(row.id),
    versionId: text(row.version_id),
    signalCode: parseEnum(row.signal_code, listSignalCodes(), FALLBACK_CODE),
    subjectType: parseEnum(row.subject_type, SUBJECT_TYPES, 'issue'),
    subjectId: text(row.subject_id),
    grantedBy: text(row.granted_by),
    reason: text(row.reason),
    grantedAt: fromSqlTimestamp(row.granted_at),
    expiresAt: fromSqlTimestamp(row.expires_at),
  };
  const closedAt = fromSqlTimestampOrNull(row.closed_at);
  if (closedAt) waiver.closedAt = closedAt;
  const closedReason = optionalText(row.closed_reason);
  if (closedReason) waiver.closedReason = closedReason;
  return waiver;
}

/* -------------------------------------------------------------- decision */

export function decisionToRow(decision: Decision): DecisionRow {
  return {
    id: decision.id,
    version_id: decision.versionId,
    snapshot_id: decision.snapshotId,
    decided_by: decision.decidedBy,
    decided_at: toSqlTimestamp(decision.decidedAt) ?? '',
    decision: decision.decision,
    verdict_at_decision: decision.verdictAtDecision,
    note: decision.note ?? null,
  };
}

export function rowToDecision(row: DecisionRow): Decision {
  const decision: Decision = {
    id: text(row.id),
    versionId: text(row.version_id),
    snapshotId: text(row.snapshot_id),
    decidedBy: text(row.decided_by),
    decidedAt: fromSqlTimestamp(row.decided_at),
    decision: parseEnum(row.decision, DECISION_KINDS, 'hold'),
    verdictAtDecision: parseEnum(row.verdict_at_decision, VERDICTS, 'not-applicable'),
  };
  const note = optionalText(row.note);
  if (note) decision.note = note;
  return decision;
}

/* --------------------------------------------------------------- outcome */

export function outcomeToRow(outcome: Outcome): OutcomeRow {
  return {
    version_id: outcome.versionId,
    checked_at: toSqlTimestamp(outcome.checkedAt) ?? '',
    incidents_json: jsonText(outcome.incidents),
    rollback: toSqlBoolean(outcome.rollback),
    notes: outcome.notes,
  };
}

export function rowToOutcome(row: OutcomeRow): Outcome {
  return {
    versionId: text(row.version_id),
    checkedAt: fromSqlTimestamp(row.checked_at),
    incidents: parseIncidents(jsonValue(row.incidents_json)),
    rollback: fromSqlBoolean(row.rollback),
    notes: text(row.notes),
  };
}

/* ------------------------------------------------- settings & collection */

/* Split into `mapping-policy.ts` (file size rule); re-exported here so every
 * caller keeps importing from `./mapping.js`. */
export {
  collectionToRow,
  rowToCollection,
  policyToRow,
  rowToPolicy,
  serviceMapToRows,
  rowsToServiceMap,
} from './mapping-policy.js';
export type { PolicyRules } from './mapping-policy.js';
export { DEFAULT_POLICY_RULES } from './mapping-policy.js';

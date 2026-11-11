/**
 * Core domain types: severities, verdicts, signals, coverage, policy, waivers,
 * decisions, dossiers, simulation, graph and permissions.
 *
 * Pure TypeScript, no import: the decision engine stays testable outside a
 * Forge runtime. Human-facing text is a MessageRef resolved by src/i18n, so the
 * UI ships in English and French (SPEC §15).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Delivery lot from SPEC §5: M = needed for the submission, S = nice, C = later. */
export type Lot = 'M' | 'S' | 'C';

/** Signal weight. `blocking` alone can produce a no-go (SPEC §8). */
export type Severity = 'blocking' | 'major' | 'minor' | 'info';

/** Most severe first — used for grouping and sorting everywhere. */
export const SEVERITY_ORDER: readonly Severity[] = [
  'blocking',
  'major',
  'minor',
  'info',
] as const;

/** The app's recommendation. The decision itself stays human (SPEC §4). */
export type Verdict = 'go' | 'conditional-go' | 'no-go' | 'not-applicable';

/** Driven by data coverage, never by optimism (SPEC §8). */
export type Confidence = 'high' | 'medium' | 'low';

/** `waived` and `cleared` signals still count for coverage, not for the verdict. */
export type SignalStatus = 'active' | 'waived' | 'cleared';

export type SubjectType =
  | 'issue'
  | 'version'
  | 'service'
  | 'incident'
  | 'page'
  | 'pull-request'
  | 'build'
  | 'commit'
  | 'team';

export interface SubjectRef {
  subjectType: SubjectType;
  subjectId: string;
}

/** What the team actually did, recorded with the verdict of the moment. */
export type DecisionKind = 'ship' | 'hold' | 'delay';

export type Locale = 'en' | 'fr';

/** Localizable text: an i18n key plus its parameters. */
export interface MessageRef {
  key: string;
  params?: Record<string, string | number>;
}

/** A clickable proof. `restricted` implements SPEC RI-10 (hidden evidence). */
export interface Evidence extends SubjectRef {
  label: MessageRef;
  url?: string;
  restricted?: boolean;
}

/** Every signal code from the SPEC §7 catalogue. */
export type SignalCode =
  | 'COMP-01'
  | 'COMP-02'
  | 'COMP-03'
  | 'COMP-04'
  | 'QUAL-01'
  | 'QUAL-02'
  | 'QUAL-03'
  | 'DEP-01'
  | 'DEP-02'
  | 'DEP-03'
  | 'EXP-01'
  | 'EXP-02'
  | 'EXP-03'
  | 'EXP-04'
  | 'DOC-01'
  | 'HIST-01'
  | 'OBJ-01';

/** Catalogue entry: what a signal is, before any data is looked at. */
export interface SignalDefinition {
  code: SignalCode;
  lot: Lot;
  defaultSeverity: Severity;
  /** Human-readable data source, shown in the settings screen. */
  source: MessageRef;
  title: MessageRef;
  /** Why it matters — second of the four things every signal shows. */
  why: MessageRef;
  /** How to clear it — fourth of the four things every signal shows. */
  clear: MessageRef;
  /** Subject the signal is raised about; drives the evidence link. */
  subjectType: SubjectType;
  /** False when the signal needs data the app cannot always get. */
  alwaysAvailable: boolean;
}

/** A raised signal: definition + observed subject + proof + status. */
export interface Signal extends SubjectRef {
  /** Stable identity: `${code}:${subjectType}:${subjectId}`. */
  id: string;
  code: SignalCode;
  /** Effective severity, after the per-project policy override (RI-11). */
  severity: Severity;
  status: SignalStatus;
  /** What is observed, with the concrete values. */
  finding: MessageRef;
  evidence: Evidence[];
  detectedAt: string;
  /** Kept across recomputes so "since yesterday" diffs are stable (RI-14). */
  firstSeenAt: string;
  waiverId?: string;
}

/** Data sources the engine can draw from. */
export type SourceName =
  | 'jira'
  | 'development'
  | 'teamwork-graph'
  | 'jsm'
  | 'confluence'
  | 'compass'
  | 'service-map';

export type SourceState = 'ok' | 'partial' | 'empty' | 'unavailable';

export interface SourceStatus {
  source: SourceName;
  state: SourceState;
  /** Explains an `unavailable`/`partial` state, e.g. a missing graph scope. */
  detail?: MessageRef;
}

/**
 * Coverage: how much the app actually sees (SPEC §4 and §8). Missing data is
 * reported, never read as "everything is fine" (SPEC §15, honesty).
 */
export interface Coverage {
  issueCount: number;
  issuesWithCode: number;
  issuesWithService: number;
  /** issuesWithCode / issueCount, 0 when the release has no issue. */
  codeRatio: number;
  serviceRatio: number;
  sources: SourceStatus[];
  /** True above 1 000 issues: minor signals are sampled (SPEC §15). */
  sampledMinorSignals: boolean;
  notes: MessageRef[];
}

export interface SeverityCounts extends Record<Severity, number> {
  blocking: number;
  major: number;
  minor: number;
  info: number;
}

/** Result of the deterministic verdict computation (SPEC §8). */
export interface VerdictResult {
  verdict: Verdict;
  confidence: Confidence;
  coverage: Coverage;
  /** Active signals only, by severity. */
  counts: SeverityCounts;
  /** Enumerated conditions for `conditional-go` (SPEC §6.1 step 7). */
  conditions: Condition[];
  /** Issue keys holding the release: what "simulate without" offers. */
  blockingIssueKeys: string[];
}

export interface Condition extends SubjectRef {
  signalCode: SignalCode;
  severity: Severity;
  text: MessageRef;
}

/* --------------------------------------------------------------- policy */

export interface ServiceMapEntry {
  /** Stable id used across signals, evidence and the impact graph. */
  serviceId: string;
  serviceName: string;
  jiraComponent?: string;
  compassComponentId?: string;
  jsmService?: string;
}

export interface Policy {
  projectId: string;
  /** Per-project severity overrides (RI-11). */
  severityOverrides: Partial<Record<SignalCode, Severity>>;
  disabledSignals: SignalCode[];
  /** Account ids allowed to grant a waiver (RI-07). */
  waiverApprovers: string[];
  /** JSM projects watched for incidents. */
  jsmProjectKeys: string[];
  serviceMap: ServiceMapEntry[];
  /** Observation mode: no verdict shown on issues (SPEC §20, third risk). */
  observationMode: boolean;
  /** Hours a waiver lasts when the caller does not say. */
  defaultWaiverHours: number;
}

export interface Waiver extends SubjectRef {
  id: string;
  versionId: string;
  signalCode: SignalCode;
  grantedBy: string;
  /** Mandatory, never optional (RI-07). */
  reason: string;
  grantedAt: string;
  expiresAt: string;
  /** Waivers are closed, never deleted (SPEC §15, traceability). */
  closedAt?: string;
  closedReason?: string;
}

export interface Decision {
  id: string;
  versionId: string;
  snapshotId: string;
  decidedBy: string;
  decidedAt: string;
  decision: DecisionKind;
  verdictAtDecision: Verdict;
  note?: string;
}

export interface OutcomeIncident {
  key: string;
  severity: Severity;
  resolvedAfterMinutes?: number;
  url?: string;
}

/** What happened in the 72 h after the release (RI-15). */
export interface Outcome {
  versionId: string;
  checkedAt: string;
  incidents: OutcomeIncident[];
  rollback: boolean;
  notes: string;
}

/* ------------------------------------------------------------- dossier */

export interface Snapshot {
  id: string;
  projectId: string;
  projectKey: string;
  versionId: string;
  versionName: string;
  versionReleased: boolean;
  computedAt: string;
  verdict: Verdict;
  confidence: Confidence;
  coverage: Coverage;
  counts: SeverityCounts;
  /** LLM-written, then checked against the signals (SPEC §8, RI-06). */
  narrative: string;
  narrativeVerified: boolean;
  /** Rejected sentences, kept for the audit trail. */
  narrativeRejections: string[];
  graphCachedAt: string | null;
  previousSnapshotId: string | null;
}

/** A release dossier: what every screen reads (SPEC §4). */
export interface ReleaseDossier {
  snapshot: Snapshot;
  signals: Signal[];
  waivers: Waiver[];
  decisions: Decision[];
  outcome: Outcome | null;
}

export interface SnapshotDiff {
  previousSnapshotId: string | null;
  added: Signal[];
  cleared: Signal[];
  severityChanged: { signalId: string; from: Severity; to: Severity }[];
  verdictChange: { from: Verdict; to: Verdict } | null;
}

/* ---------------------------------------------------------- simulation */

export interface Simulation {
  removedIssueKeys: string[];
  result: VerdictResult;
  droppedSignalCount: number;
}

export interface MinimalRemoval {
  issueKeys: string[];
  simulationsRun: number;
  /** False when the search was bounded and a smaller set may exist. */
  provenMinimal: boolean;
}

/* ------------------------------------------------------- impacted teams */

export interface ImpactedTeam {
  teamId: string;
  teamName: string;
  services: { serviceId: string; serviceName: string }[];
  issues: { key: string; summary: string; projectKey: string }[];
  /** How the team was found: graph, cross-project link, or component map. */
  via: 'graph' | 'link' | 'component';
}

/* ------------------------------------------------------------ graph UI */

export type GraphNodeKind =
  | 'version'
  | 'issue'
  | 'service'
  | 'team'
  | 'incident'
  | 'page'
  | 'pull-request';

export interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  url?: string;
  restricted?: boolean;
}

export interface GraphEdge {
  from: string;
  to: string;
  kind: string;
}

export interface ImpactGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Above 150 nodes the list view replaces the graph (SPEC §11). */
  truncated: boolean;
}

/* --------------------------------------------------------- permissions */

/**
 * Visibility oracle for RI-10: evidence the reader may not see is replaced by
 * "1 hidden item" and still counts in the verdict.
 */
export interface VisibilityChecker {
  isVisible(ref: SubjectRef): boolean;
}

export interface Viewer {
  accountId: string;
  locale: Locale;
  canWaive: boolean;
  visibility: VisibilityChecker;
}

/* -------------------------------------------------------------- limits */

/** Above this issue count, minor signals are sampled (SPEC §15). */
export const ISSUE_SAMPLE_THRESHOLD = 1000;

/** Above this node count, the graph view falls back to a list (SPEC §11). */
export const GRAPH_NODE_LIMIT = 150;

/** Confidence thresholds from SPEC §8. */
export const CONFIDENCE_RULES = {
  highCodeRatio: 0.9,
  highServiceRatio: 0.8,
  lowCodeRatio: 0.7,
} as const;

/** A ticket added less than this many hours ago raises COMP-04. */
export const RECENT_ADD_HOURS = 48;

/** An incident resolved less than this many days ago raises EXP-02. */
export const RECENT_INCIDENT_DAYS = 7;

/** The outcome window after a release (RI-15). */
export const OUTCOME_WINDOW_HOURS = 72;

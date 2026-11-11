/**
 * Contracts of the 8 Rovo / MCP actions (SPEC §10, R2).
 *
 * One action = one manifest entry (`action`, reused by `rovo:mcp` tools) + one
 * pure handler `(input, deps) => output`. The platform only accepts `string |
 * integer | number | boolean` inputs (R2 §1.2, §7.1), so lists travel as CSV:
 * every action parses its raw payload through `parseXxxInput` before the
 * handler runs — an invalid input raises an explicit `ActionError`, never a
 * crash inside a handler.
 *
 * Handlers never collect: they read the last saved dossier (SPEC §12). The few
 * facts a dossier does not carry (version id from a name, cached collection,
 * signal id → version) come from the read-only `DossierIndex` port.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { Clock, Logger, ReleaseStore } from '../ports';
import type {
  CollectedRelease,
  Condition,
  Confidence,
  Coverage,
  DecisionKind,
  Evidence,
  ImpactedTeam,
  Locale,
  Lot,
  MessageRef,
  OutcomeIncident,
  Severity,
  SeverityCounts,
  Signal,
  SignalCode,
  SignalStatus,
  Verdict,
  Viewer,
  VisibilityChecker,
  Waiver,
} from '../types';

/* ------------------------------------------------------------- identity */

/** Action keys, in SPEC §10 order (also the `rovo:mcp` tool order). */
export type ActionKey =
  | 'get-release-impact'
  | 'list-release-signals'
  | 'explain-signal'
  | 'list-impacted-teams'
  | 'simulate-without'
  | 'get-release-outcome'
  | 'request-waiver'
  | 'close-waiver';

/** Manifest verbs actually used by this app (R2 §1.2). */
export type ActionVerb = 'GET' | 'CREATE';

/** The only input types the platform accepts — no array, no object. */
export type ActionInputType = 'string' | 'integer' | 'number' | 'boolean';

export interface ActionInputSpec {
  title: string;
  type: ActionInputType;
  required: boolean;
  description: string;
}

/** Why an action refused to run. `invalid-input` is a caller mistake. */
export type ActionErrorCode =
  | 'invalid-input'
  | 'version-unknown'
  | 'signal-unknown'
  | 'no-facts'
  | 'no-policy'
  | 'not-wired';

export class ActionError extends Error {
  readonly code: ActionErrorCode;

  constructor(code: ActionErrorCode, message: string) {
    super(message);
    this.name = 'ActionError';
    this.code = code;
  }
}

/* --------------------------------------------------------------- inputs */

export interface GetReleaseImpactInput {
  projectKey: string;
  versionName: string;
}

export interface ListReleaseSignalsInput {
  versionId: string;
  severity?: Severity;
}

export interface ExplainSignalInput {
  signalId: string;
}

export interface ListImpactedTeamsInput {
  versionId: string;
}

export interface SimulateWithoutInput {
  versionId: string;
  /** Comma-separated Jira keys, as the platform cannot carry an array. */
  issueKeys: string;
}

export interface GetReleaseOutcomeInput {
  versionId: string;
}

export interface RequestWaiverInput {
  signalId: string;
  /** Empty string is a valid payload: the refusal is then motivated (RI-07). */
  reason: string;
  hours?: number;
}

/* -------------------------------------------------------------- outputs */

/** One signal as the agent or an MCP client reads it (title/why/clear). */
export interface SignalView {
  id: string;
  code: SignalCode;
  severity: Severity;
  status: SignalStatus;
  title: MessageRef;
  why: MessageRef;
  clear: MessageRef;
  finding: MessageRef;
  evidence: Evidence[];
  detectedAt: string;
  firstSeenAt: string;
}

/** Short form used to answer "what is holding this version?". */
export interface SignalSummary {
  id: string;
  code: SignalCode;
  severity: Severity;
  title: MessageRef;
  finding: MessageRef;
}

export interface GetReleaseImpactOutput {
  projectKey: string;
  versionId: string;
  versionName: string;
  verdict: Verdict;
  verdictTitle: MessageRef;
  confidence: Confidence;
  confidenceTitle: MessageRef;
  counts: SeverityCounts;
  signalCount: number;
  /** Signals that hold the release, most severe first (max 3). */
  topSignals: SignalSummary[];
  summary: string;
  summaryVerified: boolean;
  computedAt: string;
  versionReleased: boolean;
  previousSnapshotId: string | null;
  coverage: Coverage;
}

export interface ListReleaseSignalsOutput {
  versionId: string;
  versionName: string;
  verdict: Verdict;
  total: number;
  counts: SeverityCounts;
  severityFilter: Severity | null;
  signals: SignalView[];
}

export interface ExplainSignalOutput {
  signalId: string;
  versionId: string;
  code: SignalCode;
  severity: Severity;
  status: SignalStatus;
  lot: Lot;
  title: MessageRef;
  why: MessageRef;
  finding: MessageRef;
  /** How to clear it — "levée possible" in SPEC §10. */
  clear: MessageRef;
  source: MessageRef;
  alwaysAvailable: boolean;
  evidence: Evidence[];
  waiver: Waiver | null;
  /** True when this caller may actually request the waiver (RI-07). */
  canRequestWaiver: boolean;
  detectedAt: string;
  firstSeenAt: string;
}

export interface ImpactedServiceView {
  serviceId: string;
  serviceName: string;
  teamIds: string[];
  issueKeys: string[];
}

export interface ImpactedTicketView {
  key: string;
  summary: string;
  projectKey: string;
  serviceId: string | null;
  teamIds: string[];
  /** False for a ticket outside the release that links to it (DEP-02). */
  inRelease: boolean;
}

export interface ListImpactedTeamsOutput {
  versionId: string;
  versionName: string;
  teams: ImpactedTeam[];
  services: ImpactedServiceView[];
  tickets: ImpactedTicketView[];
  /** Date of the cached collection; null when nothing was ever collected. */
  factsCachedAt: string | null;
  coverage: Coverage;
}

export interface DecisionView {
  id: string;
  kind: DecisionKind;
  decidedBy: string;
  decidedAt: string;
  verdictAtDecision: Verdict;
  note?: string;
}

export interface OutcomeView {
  checkedAt: string;
  incidents: OutcomeIncident[];
  rollback: boolean;
  notes: string;
  summary: MessageRef;
}

export interface GetReleaseOutcomeOutput {
  versionId: string;
  versionName: string;
  verdict: Verdict;
  versionReleased: boolean;
  decision: DecisionView | null;
  /** Null while the 72 h window is still open: absence is not good news. */
  outcome: OutcomeView | null;
}

export interface SimulateWithoutOutput {
  versionId: string;
  versionName: string;
  removedIssueKeys: string[];
  /** Keys the release does not contain — reported, never silently ignored. */
  unknownIssueKeys: string[];
  verdictBefore: Verdict;
  verdict: Verdict;
  confidence: Confidence;
  counts: SeverityCounts;
  droppedSignalCount: number;
  droppedSignalIds: string[];
  conditions: Condition[];
  /**
   * Smallest set of tickets whose removal lifts the no-go (RI-13), or null when
   * the verdict is not no-go. Contract shared by the action and the UI.
   */
  minimalRemoval: MinimalRemovalView | null;
}

export interface MinimalRemovalView {
  issueKeys: string[];
  simulationsRun: number;
  /** False when the bounded search stopped before proving minimality. */
  provenMinimal: boolean;
}

export type RequestWaiverOutput =
  | { granted: true; waiver: Waiver }
  | { granted: false; refusal: MessageRef };

/* ----------------------------------------------------------------- ports */

/** A project version resolved from a project key + version name (SPEC §10). */
export interface ResolvedVersion {
  projectId: string;
  projectKey: string;
  versionId: string;
  versionName: string;
}

/** The collection cached in the dossier, with its date (SPEC §12). */
export interface ReleaseFacts {
  cachedAt: string;
  release: CollectedRelease;
}

/** A signal found from its id alone (`explain-signal` has no versionId). */
export interface LocatedSignal {
  versionId: string;
  signal: Signal;
}

/**
 * Read-only lookups the saved dossier cannot answer on its own.
 *
 * Adapter side: Jira project versions REST (name → id), the collection cached
 * with the dossier, and the signal index. Never a live collection (SPEC §12).
 */
export interface DossierIndex {
  resolveVersion(projectKey: string, versionName: string): Promise<ResolvedVersion | null>;
  getFacts(versionId: string): Promise<ReleaseFacts | null>;
  findSignal(signalId: string): Promise<LocatedSignal | null>;
}

/** Everything an action handler may use — injected, never global. */
export interface ActionDeps {
  store: ReleaseStore;
  index: DossierIndex;
  clock: Clock;
  logger: Logger;
  /** Caller identity from `context.principal.accountId`, never from inputs (R2 §2.3). */
  viewer: Viewer;
}

/* --------------------------------------------------------------- parsing */

export type ActionHandler<I, O> = (input: I, deps: ActionDeps) => Promise<O>;

export interface ActionSpec<I, O> {
  key: ActionKey;
  verb: ActionVerb;
  name: string;
  description: string;
  inputs: Record<string, ActionInputSpec>;
  parse: (raw: Record<string, unknown>) => I;
  handler: ActionHandler<I, O>;
}

/** What the resolver, the `action` module and `rovo:mcp` all consume. */
export interface ActionDefinition {
  key: ActionKey;
  verb: ActionVerb;
  name: string;
  description: string;
  inputs: Record<string, ActionInputSpec>;
  run: (raw: Record<string, unknown>, deps: ActionDeps) => Promise<unknown>;
}

/** Erases the handler generics once, so the registry stays one typed table. */
export function defineAction<I, O>(spec: ActionSpec<I, O>): ActionDefinition {
  return {
    key: spec.key,
    verb: spec.verb,
    name: spec.name,
    description: spec.description,
    inputs: spec.inputs,
    run: (raw, deps) => spec.handler(spec.parse(raw), deps),
  };
}

/** `string` or `integer` input; anything else is a caller mistake. */
function readScalar(raw: Record<string, unknown>, field: string): string | undefined {
  const value = raw[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  throw new ActionError('invalid-input', `Input "${field}" must be a string or a number.`);
}

export function requireString(raw: Record<string, unknown>, field: string): string {
  const value = readScalar(raw, field);
  if (value === undefined || value.length === 0) {
    throw new ActionError('invalid-input', `Input "${field}" is required.`);
  }
  return value;
}

export function optionalString(raw: Record<string, unknown>, field: string): string | undefined {
  const value = readScalar(raw, field);
  return value !== undefined && value.length > 0 ? value : undefined;
}

/** Splits `"PAY-12, PAY-45"` into keys, trimming, dropping blanks and duplicates. */
export function parseIssueKeys(input: string): string[] {
  const seen = new Set<string>();
  for (const token of input.split(/[,;]/)) {
    const key = token.trim();
    if (key.length > 0) seen.add(key);
  }
  return [...seen];
}

/** Legacy LLM wordings (R2 §6) mapped onto the SPEC §7 severities. */
const SEVERITY_ALIASES: Record<string, Severity> = {
  critical: 'blocking',
  high: 'major',
  medium: 'minor',
  low: 'info',
};

export function parseSeverity(input: string): Severity {
  const token = input.trim().toLowerCase();
  const severity = SEVERITY_ALIASES[token] ?? token;
  if (
    severity !== 'blocking' &&
    severity !== 'major' &&
    severity !== 'minor' &&
    severity !== 'info'
  ) {
    throw new ActionError(
      'invalid-input',
      `Unknown severity "${input}". Use blocking, major, minor or info.`,
    );
  }
  return severity;
}

/** `hours` is optional: without it the policy default applies (SPEC §7 RI-07). */
export function parseHours(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const hours = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(hours)) {
    throw new ActionError('invalid-input', 'Input "hours" must be a number of hours.');
  }
  return hours;
}

export function parseGetReleaseImpactInput(raw: Record<string, unknown>): GetReleaseImpactInput {
  return { projectKey: requireString(raw, 'projectKey'), versionName: requireString(raw, 'versionName') };
}

export function parseListReleaseSignalsInput(raw: Record<string, unknown>): ListReleaseSignalsInput {
  const severity = optionalString(raw, 'severity');
  const versionId = requireString(raw, 'versionId');
  return severity === undefined ? { versionId } : { versionId, severity: parseSeverity(severity) };
}

export function parseExplainSignalInput(raw: Record<string, unknown>): ExplainSignalInput {
  return { signalId: requireString(raw, 'signalId') };
}

export function parseListImpactedTeamsInput(raw: Record<string, unknown>): ListImpactedTeamsInput {
  return { versionId: requireString(raw, 'versionId') };
}

export function parseSimulateWithoutInput(raw: Record<string, unknown>): SimulateWithoutInput {
  const versionId = requireString(raw, 'versionId');
  const issueKeys = requireString(raw, 'issueKeys');
  if (parseIssueKeys(issueKeys).length === 0) {
    throw new ActionError(
      'invalid-input',
      'Input "issueKeys" must list at least one key, e.g. "PAY-12,PAY-45".',
    );
  }
  return { versionId, issueKeys };
}

export function parseGetReleaseOutcomeInput(raw: Record<string, unknown>): GetReleaseOutcomeInput {
  return { versionId: requireString(raw, 'versionId') };
}

export function parseRequestWaiverInput(raw: Record<string, unknown>): RequestWaiverInput {
  const signalId = requireString(raw, 'signalId');
  const reason = optionalString(raw, 'reason') ?? '';
  const hours = parseHours(raw['hours']);
  return hours === undefined ? { signalId, reason } : { signalId, reason, hours };
}

/* ---------------------------------------------------------------- viewer */

const VISIBLE_TO_ALL: VisibilityChecker = { isVisible: () => true };

/** Builds the viewer from the Forge invocation context (never from inputs). */
export function makeViewer(accountId: string, partial: Partial<Omit<Viewer, 'accountId'>> = {}): Viewer {
  const locale: Locale = partial.locale ?? 'en';
  return {
    accountId,
    locale,
    canWaive: partial.canWaive ?? false,
    visibility: partial.visibility ?? VISIBLE_TO_ALL,
  };
}

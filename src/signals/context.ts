import type {
  CollectedRelease,
  Outcome,
  Policy,
  Severity,
  Signal,
  SignalCode,
  SubjectRef,
  Waiver,
  MessageRef,
  Evidence,
} from '../types.js';
import { getSignalDefinition } from './registry.js';

/**
 * Detection context shared by every signal detector.
 *
 * All detectors are pure functions of this object: `now` is injected so tests
 * are deterministic, and `previousSignals` preserves `firstSeenAt` across
 * recomputes (RI-14 diffs stay stable).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
export interface DetectionContext {
  release: CollectedRelease;
  policy: Policy;
  /** ISO 8601 evaluation instant. */
  now: string;
  /** Waivers stored for this version (expired ones are filtered by the caller). */
  waivers: Waiver[];
  /** Signals of the previous snapshot, used to carry `firstSeenAt` over. */
  previousSignals: Signal[];
  /** Past 72 h outcomes of previous releases on the same project (HIST-01). */
  pastOutcomes: Outcome[];
}

/** A detector raises zero or more signals for one release. */
export type Detector = (ctx: DetectionContext) => Signal[];

/** Stable identity so a signal survives recomputes and diffs. */
export function signalId(code: SignalCode, subject: SubjectRef): string {
  return `${code}:${subject.subjectType}:${subject.subjectId}`;
}

/** Per-project severity override wins over the catalogue default (RI-11). */
export function effectiveSeverity(code: SignalCode, policy: Policy): Severity {
  const override = policy.severityOverrides[code];
  return override ?? getSignalDefinition(code).defaultSeverity;
}

/** A signal can be turned off per project (SPEC §20, "verdict too strict"). */
export function isSignalEnabled(code: SignalCode, policy: Policy): boolean {
  return !policy.disabledSignals.includes(code);
}

function isWaiverLive(waiver: Waiver, now: string): boolean {
  if (waiver.closedAt) return false;
  return waiver.expiresAt > now;
}

/** The waiver covering this signal, if a person granted one that has not expired. */
export function activeWaiverFor(
  waivers: Waiver[],
  code: SignalCode,
  subject: SubjectRef,
  now: string,
): Waiver | undefined {
  return waivers.find(
    (w) =>
      w.signalCode === code &&
      w.subjectId === subject.subjectId &&
      isWaiverLive(w, now),
  );
}

export interface NewSignalInput {
  code: SignalCode;
  subject: SubjectRef;
  /** What was observed, with the concrete values interpolated by i18n. */
  finding: MessageRef;
  evidence: Evidence[];
}

/**
 * Builds a signal: severity from policy, status from waivers, `firstSeenAt`
 * carried over from the previous snapshot when the signal already existed.
 */
export function makeSignal(ctx: DetectionContext, input: NewSignalInput): Signal {
  const { code, subject } = input;
  const id = signalId(code, subject);
  const waiver = activeWaiverFor(ctx.waivers, code, subject, ctx.now);
  const previous = ctx.previousSignals.find((s) => s.id === id);
  return {
    id,
    code,
    subjectType: subject.subjectType,
    subjectId: subject.subjectId,
    severity: effectiveSeverity(code, ctx.policy),
    status: waiver ? 'waived' : 'active',
    finding: input.finding,
    evidence: input.evidence,
    detectedAt: ctx.now,
    firstSeenAt: previous?.firstSeenAt ?? ctx.now,
    ...(waiver ? { waiverId: waiver.id } : {}),
  };
}

/** Skips a detector body when the project disabled the signal. */
export function enabledSignals(codes: SignalCode[], policy: Policy): SignalCode[] {
  return codes.filter((code) => isSignalEnabled(code, policy));
}

export function hoursBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return ms / 3_600_000;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return hoursBetween(fromIso, toIso) / 24;
}

/** Convenience: the release's own issues, filtered by a predicate. */
export function issuesMatching(
  release: CollectedRelease,
  predicate: (issue: CollectedRelease['issues'][number]) => boolean,
): CollectedRelease['issues'] {
  return release.issues.filter(predicate);
}

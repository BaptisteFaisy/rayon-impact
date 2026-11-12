/**
 * Decision actions: `record-decision`, `simulate-without`, `request-waiver`,
 * `close-waiver` (SPEC §10).
 *
 * `record-decision` stores the human decision with the verdict of the saved
 * dossier — the verdict is never taken from the inputs, and the decider is the
 * Forge viewer (RI-08, R2 §2.3). Decisions accumulate, never deleted (SPEC §15).
 * `simulate-without` replays the deterministic verdict on the saved signals
 * minus a set of tickets — no live collection, no guess (SPEC §12, RI-13).
 * `request-waiver` either creates the waiver or answers with a motivated
 * refusal; `close-waiver` closes it the same way (never deletes, SPEC §15).
 * The refusal rules are the engine's (src/engine/waiver.ts), never recopied
 * here (RI-07).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { computeVerdict } from '../engine/verdict';
import {
  minimalRemovalSet,
  signalsWithoutIssues,
  simulateWithout as simulateVerdict,
} from '../engine/simulate';
import { latestDecision, recordDecision } from '../engine/decision';
import {
  closeWaiver,
  grantWaiver,
  validateWaiverRequest,
  type WaiverRequest,
} from '../engine/waiver';
import type {
  CollectedRelease,
  Coverage,
  Decision,
  DecisionKind,
  MessageRef,
  Policy,
  Signal,
  Verdict,
  Viewer,
  Waiver,
} from '../types';
import { requireDossier, requirePolicy } from './release';
import { ActionError, optionalString, parseIssueKeys, requireString } from './types';
import type {
  ActionDeps,
  MinimalRemovalView,
  RequestWaiverInput,
  RequestWaiverOutput,
  SimulateWithoutInput,
  SimulateWithoutOutput,
} from './types';

/**
 * The project role may allow waiving without being listed in the policy
 * (`viewer.canWaive`): the approver list is widened, never narrowed, so the
 * engine keeps a single source of truth for the refusal rules.
 */
function policyForViewer(policy: Policy, viewer: Viewer): Policy {
  if (!viewer.canWaive || policy.waiverApprovers.includes(viewer.accountId)) return policy;
  return { ...policy, waiverApprovers: [...policy.waiverApprovers, viewer.accountId] };
}

function knownIssueKeys(releaseKeys: { key: string }[], removed: string[]): string[] {
  const known = new Set(releaseKeys.map((issue) => issue.key));
  return removed.filter((key) => !known.has(key));
}

/** The collection cached with the dossier: a simulation never re-collects. */
async function requireFacts(deps: ActionDeps, versionId: string) {
  const facts = await deps.index.getFacts(versionId);
  if (!facts) {
    throw new ActionError(
      'no-facts',
      `No cached collection for version ${versionId}: the simulation needs the last collected release.`,
    );
  }
  return facts;
}

/** Signals that disappear when the given tickets leave the release. */
function droppedSignals(
  all: Signal[],
  removed: string[],
  release: CollectedRelease,
): Signal[] {
  const remaining = new Set(
    signalsWithoutIssues(all, removed, release).map((signal) => signal.id),
  );
  return all.filter((signal) => !remaining.has(signal.id));
}

/**
 * RI-13: the smallest set of tickets whose removal lifts the no-go — computed
 * only when the current verdict is a no-go, otherwise there is nothing to lift.
 */
function minimalRemovalFor(
  verdict: Verdict,
  signals: Signal[],
  coverage: Coverage,
  release: CollectedRelease,
): MinimalRemovalView | null {
  if (verdict !== 'no-go') return null;
  const minimal = minimalRemovalSet({ signals, coverage, release, verdict: computeVerdict });
  return {
    issueKeys: minimal.issueKeys,
    simulationsRun: minimal.simulationsRun,
    provenMinimal: minimal.provenMinimal,
  };
}

/** `simulate-without`: the verdict if these tickets left the release. */
export async function simulateWithout(
  input: SimulateWithoutInput,
  deps: ActionDeps,
): Promise<SimulateWithoutOutput> {
  const dossier = await requireDossier(deps, input.versionId);
  const facts = await requireFacts(deps, input.versionId);
  const removed = parseIssueKeys(input.issueKeys);
  const coverage = dossier.snapshot.coverage;
  const simulation = simulateVerdict({
    signals: dossier.signals,
    coverage,
    release: facts.release,
    issueKeys: removed,
    verdict: computeVerdict,
  });
  const dropped = droppedSignals(dossier.signals, removed, facts.release);
  const minimal = minimalRemovalFor(
    dossier.snapshot.verdict,
    dossier.signals,
    coverage,
    facts.release,
  );

  deps.logger.log('info', 'action.simulate-without', {
    versionId: input.versionId,
    removed: removed.length,
    verdict: simulation.result.verdict,
  });
  return {
    versionId: input.versionId,
    versionName: dossier.snapshot.versionName,
    removedIssueKeys: simulation.removedIssueKeys,
    unknownIssueKeys: knownIssueKeys(
      [...facts.release.issues, ...facts.release.linkedOutsideIssues],
      removed,
    ),
    verdictBefore: dossier.snapshot.verdict,
    verdict: simulation.result.verdict,
    confidence: simulation.result.confidence,
    counts: simulation.result.counts,
    droppedSignalCount: simulation.droppedSignalCount,
    droppedSignalIds: dropped.map((signal) => signal.id),
    conditions: simulation.result.conditions,
    minimalRemoval: minimal,
  };
}

/** `request-waiver`: the waiver, or a motivated refusal (RI-07). */
export async function requestWaiver(
  input: RequestWaiverInput,
  deps: ActionDeps,
): Promise<RequestWaiverOutput> {
  const located = await deps.index.findSignal(input.signalId);
  if (!located) {
    throw new ActionError('signal-unknown', `No signal with id "${input.signalId}" is recorded.`);
  }
  const { signal, versionId } = located;
  const dossier = await requireDossier(deps, versionId);
  const policy = policyForViewer(
    await requirePolicy(deps, dossier.snapshot.projectId),
    deps.viewer,
  );
  const now = deps.clock.now();
  const request: WaiverRequest = {
    versionId,
    signalCode: signal.code,
    subjectType: signal.subjectType,
    subjectId: signal.subjectId,
    reason: input.reason,
    grantedBy: deps.viewer.accountId,
    ...(input.hours === undefined ? {} : { hours: input.hours }),
  };
  const verdict = validateWaiverRequest(request, policy, now);
  if (!verdict.ok) {
    deps.logger.log('warn', 'action.request-waiver.refused', {
      signalId: signal.id,
      reason: verdict.reason.key,
    });
    return { granted: false, refusal: verdict.reason };
  }
  const waiver = grantWaiver(request, policy, now);
  await deps.store.saveWaiver(waiver);
  deps.logger.log('info', 'action.request-waiver.granted', {
    signalId: signal.id,
    waiverId: waiver.id,
  });
  return { granted: true, waiver };
}

/* ---------------------------------------------------------- close-waiver */

/**
 * `close-waiver` contract. Kept here, next to its handler, so `types.ts`
 * stays under the 500-line limit; same shape as the other actions.
 */
export interface CloseWaiverInput {
  waiverId: string;
  /** Empty string is a valid payload: the refusal is then motivated (RI-07). */
  reason: string;
}

export type CloseWaiverOutput =
  | { closed: true; waiver: Waiver }
  | { closed: false; refusal: MessageRef };

export function parseCloseWaiverInput(raw: Record<string, unknown>): CloseWaiverInput {
  return {
    waiverId: requireString(raw, 'waiverId'),
    reason: optionalString(raw, 'reason') ?? '',
  };
}

/** Refusal helper: logged once, returned as data — never a platform failure. */
function closeRefusal(
  deps: ActionDeps,
  waiverId: string,
  refusal: MessageRef,
): CloseWaiverOutput {
  deps.logger.log('warn', 'action.close-waiver.refused', {
    waiverId,
    reason: refusal.key,
  });
  return { closed: false, refusal };
}

/**
 * `close-waiver`: the closed waiver, or a motivated refusal (not found,
 * already closed, missing reason, caller not allowed to waive).
 *
 * The refusal rules are the engine's (`validateWaiverRequest`) and the closure
 * itself is `closeWaiver` — nothing is recopied here (RI-07). A closed waiver
 * stays in the store forever (SPEC §15: closed, never deleted).
 */
export async function closeWaiverAction(
  input: CloseWaiverInput,
  deps: ActionDeps,
): Promise<CloseWaiverOutput> {
  const found = await deps.store.getWaiverById(input.waiverId);
  if (!found) {
    return closeRefusal(deps, input.waiverId, {
      key: 'waiver.notFound',
      params: { waiverId: input.waiverId },
    });
  }
  if (found.closedAt) {
    return closeRefusal(deps, input.waiverId, {
      key: 'waiver.alreadyClosed',
      params: { waiverId: found.id, closedAt: found.closedAt },
    });
  }
  const dossier = await requireDossier(deps, found.versionId);
  const policy = policyForViewer(
    await requirePolicy(deps, dossier.snapshot.projectId),
    deps.viewer,
  );
  const now = deps.clock.now();
  const request: WaiverRequest = {
    versionId: found.versionId,
    signalCode: found.signalCode,
    subjectType: found.subjectType,
    subjectId: found.subjectId,
    reason: input.reason,
    grantedBy: deps.viewer.accountId,
  };
  const verdict = validateWaiverRequest(request, policy, now);
  if (!verdict.ok) {
    return closeRefusal(deps, input.waiverId, verdict.reason);
  }
  const closed = closeWaiver(found, now, input.reason.trim());
  await deps.store.saveWaiver(closed);
  deps.logger.log('info', 'action.close-waiver.closed', {
    waiverId: closed.id,
    versionId: closed.versionId,
  });
  return { closed: true, waiver: closed };
}

/* --------------------------------------------------------- record-decision */

/**
 * `record-decision` contract (RI-08). Kept here, next to its handler, so
 * `types.ts` stays under the 500-line limit; same shape as `close-waiver`.
 */
export interface RecordDecisionInput {
  versionId: string;
  decision: DecisionKind;
  /** Optional, bounded by `MAX_DECISION_NOTE`; trimmed by the engine. */
  note?: string;
}

export interface RecordDecisionOutput {
  /** The stored decision, with the dossier verdict frozen inside (RI-08). */
  decision: Decision;
  /** The verdict of the saved dossier at the moment of the decision. */
  verdictAtDecision: Verdict;
  /**
   * True when the verdict differs from the one frozen in the previous
   * decision — false when no decision was ever recorded (SPEC §15).
   */
  verdictChanged: boolean;
}

/** Bounded note length, refused explicitly beyond (SPEC §16 case limits). */
export const MAX_DECISION_NOTE = 500;

/**
 * Runtime values of the domain `DecisionKind`. `satisfies` rejects any value
 * outside the union, and the exported guard fails to compile if the domain
 * ever adds a kind missing here — the list is derived, never invented.
 */
export const DECISION_KINDS = ['ship', 'hold', 'delay'] as const satisfies readonly DecisionKind[];

export type DecisionKindsExhaustive =
  Exclude<DecisionKind, (typeof DECISION_KINDS)[number]> extends never ? true : never;

/** Compile-time proof that `DECISION_KINDS` covers every `DecisionKind`. */
export const DECISION_KINDS_EXHAUSTIVE: DecisionKindsExhaustive = true;

/** Caller-facing validation of the `decision` input (LLM-provided string). */
export function parseDecisionKind(value: string): DecisionKind {
  const token = value.trim().toLowerCase();
  if (!(DECISION_KINDS as readonly string[]).includes(token)) {
    throw new ActionError(
      'invalid-input',
      `Unknown decision "${value}". Use ${DECISION_KINDS.join(', ')}.`,
    );
  }
  return token as DecisionKind;
}

export function parseRecordDecisionInput(raw: Record<string, unknown>): RecordDecisionInput {
  const versionId = requireString(raw, 'versionId');
  const decision = parseDecisionKind(requireString(raw, 'decision'));
  const note = optionalString(raw, 'note');
  if (note !== undefined && note.length > MAX_DECISION_NOTE) {
    throw new ActionError(
      'invalid-input',
      `Input "note" is limited to ${MAX_DECISION_NOTE} characters (got ${note.length}).`,
    );
  }
  return note === undefined ? { versionId, decision } : { versionId, decision, note };
}

/**
 * `record-decision`: store the human decision with the verdict of the moment
 * (RI-08). The verdict comes from the saved dossier (`requireDossier`, never a
 * live collection — SPEC §12) and the decider from the Forge viewer, never
 * from the inputs (R2 §2.3). The id, the note trimming and the shape are the
 * engine's (`recordDecision`) — nothing is recopied here. Decisions are only
 * appended, never deleted (SPEC §15).
 */
export async function recordDecisionAction(
  input: RecordDecisionInput,
  deps: ActionDeps,
): Promise<RecordDecisionOutput> {
  const dossier = await requireDossier(deps, input.versionId);
  const verdict = dossier.snapshot.verdict;
  const previous = latestDecision(await deps.store.getDecisions(input.versionId));
  const decision = recordDecision({
    versionId: input.versionId,
    snapshotId: dossier.snapshot.id,
    decidedBy: deps.viewer.accountId,
    decision: input.decision,
    verdictAtDecision: verdict,
    ...(input.note === undefined ? {} : { note: input.note }),
    now: deps.clock.now(),
  });
  await deps.store.saveDecision(decision);
  deps.logger.log('info', 'action.record-decision', {
    versionId: input.versionId,
    decision: decision.decision,
    verdict,
  });
  return {
    decision,
    verdictAtDecision: verdict,
    verdictChanged: previous !== null && previous.verdictAtDecision !== verdict,
  };
}

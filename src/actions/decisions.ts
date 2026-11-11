/**
 * Decision actions: `simulate-without`, `request-waiver` (SPEC §10).
 *
 * `simulate-without` replays the deterministic verdict on the saved signals
 * minus a set of tickets — no live collection, no guess (SPEC §12, RI-13).
 * `request-waiver` either creates the waiver or answers with a motivated
 * refusal: the refusal rules are the engine's (src/engine/waiver.ts), never
 * recopied here (RI-07).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { computeVerdict } from '../engine/verdict';
import { signalsWithoutIssues, simulateWithout as simulateVerdict } from '../engine/simulate';
import { grantWaiver, validateWaiverRequest, type WaiverRequest } from '../engine/waiver';
import type { Policy, Viewer } from '../types';
import { requireDossier, requirePolicy } from './release';
import { ActionError, parseIssueKeys } from './types';
import type {
  ActionDeps,
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

/** `simulate-without`: the verdict if these tickets left the release. */
export async function simulateWithout(
  input: SimulateWithoutInput,
  deps: ActionDeps,
): Promise<SimulateWithoutOutput> {
  const dossier = await requireDossier(deps, input.versionId);
  const facts = await deps.index.getFacts(input.versionId);
  if (!facts) {
    throw new ActionError(
      'no-facts',
      `No cached collection for version ${input.versionId}: the simulation needs the last collected release.`,
    );
  }
  const removed = parseIssueKeys(input.issueKeys);
  const coverage = dossier.snapshot.coverage;
  const simulation = simulateVerdict({
    signals: dossier.signals,
    coverage,
    release: facts.release,
    issueKeys: removed,
    verdict: computeVerdict,
  });
  const remaining = signalsWithoutIssues(dossier.signals, removed, facts.release);
  const remainingIds = new Set(remaining.map((signal) => signal.id));
  const dropped = dossier.signals.filter((signal) => !remainingIds.has(signal.id));
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

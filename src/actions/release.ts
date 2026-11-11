/**
 * Release-reading actions: `get-release-impact`, `list-release-signals`,
 * `explain-signal` (SPEC §10).
 *
 * Handlers are pure functions of `(input, deps)`: no Forge import, no clock
 * read (`deps.clock`), no network. They read the last saved dossier and never
 * collect (SPEC §12: "les écrans lisent toujours le dernier dossier
 * enregistré"), so the agent answers exactly what the screens show (SPEC §17.7).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { canViewerWaive } from '../engine/permissions';
import { confidenceTitle, verdictTitle } from '../engine/verdict';
import { getSignalDefinition } from '../signals/registry';
import { SEVERITY_ORDER } from '../types';
import type {
  Policy,
  ReleaseDossier,
  Severity,
  SeverityCounts,
  Signal,
  Waiver,
} from '../types';
import { ActionError } from './types';
import type {
  ActionDeps,
  ExplainSignalInput,
  ExplainSignalOutput,
  GetReleaseImpactInput,
  GetReleaseImpactOutput,
  ListReleaseSignalsInput,
  ListReleaseSignalsOutput,
  SignalSummary,
  SignalView,
} from './types';

/** Number of "what holds this version" signals returned by the impact action. */
export const TOP_SIGNAL_LIMIT = 3;

/** Most severe first, then stable by id — same order as the screens. */
export function compareSignals(a: Signal, b: Signal): number {
  const bySeverity = SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity);
  return bySeverity !== 0 ? bySeverity : a.id.localeCompare(b.id);
}

/** The saved dossier, or an explicit error: an action never invents an answer. */
export async function requireDossier(
  deps: ActionDeps,
  versionId: string,
): Promise<ReleaseDossier> {
  const dossier = await deps.store.getDossier(versionId);
  if (!dossier) {
    throw new ActionError(
      'version-unknown',
      `No impact dossier recorded for version ${versionId}. The dossier is built by the background recompute; actions only read the last saved one.`,
    );
  }
  return dossier;
}

/** Severity counts of a signal set (status kept: waived/cleared still count). */
export function countBySeverity(signals: Signal[]): SeverityCounts {
  const counts: SeverityCounts = { blocking: 0, major: 0, minor: 0, info: 0 };
  for (const signal of signals) {
    counts[signal.severity] += 1;
  }
  return counts;
}

/** Catalogue text (title/why/clear) + observed finding: no string is recopied. */
export function toSignalView(signal: Signal): SignalView {
  const definition = getSignalDefinition(signal.code);
  return {
    id: signal.id,
    code: signal.code,
    severity: signal.severity,
    status: signal.status,
    title: definition.title,
    why: definition.why,
    clear: definition.clear,
    finding: signal.finding,
    evidence: signal.evidence.map((item) => ({ ...item })),
    detectedAt: signal.detectedAt,
    firstSeenAt: signal.firstSeenAt,
  };
}

/** Signals holding the release: active only, most severe first (SPEC §8). */
export function topSignals(signals: Signal[], limit: number = TOP_SIGNAL_LIMIT): SignalSummary[] {
  return signals
    .filter((signal) => signal.status === 'active')
    .sort(compareSignals)
    .slice(0, limit)
    .map((signal) => ({
      id: signal.id,
      code: signal.code,
      severity: signal.severity,
      title: getSignalDefinition(signal.code).title,
      finding: signal.finding,
    }));
}

/** `get-release-impact`: verdict, confidence, summary and signal counts. */
export async function getReleaseImpact(
  input: GetReleaseImpactInput,
  deps: ActionDeps,
): Promise<GetReleaseImpactOutput> {
  const resolved = await deps.index.resolveVersion(input.projectKey, input.versionName);
  if (!resolved) {
    throw new ActionError(
      'version-unknown',
      `Project ${input.projectKey} has no version named "${input.versionName}".`,
    );
  }
  const dossier = await requireDossier(deps, resolved.versionId);
  const { snapshot } = dossier;
  deps.logger.log('info', 'action.get-release-impact', {
    versionId: resolved.versionId,
    verdict: snapshot.verdict,
  });
  return {
    projectKey: resolved.projectKey,
    versionId: resolved.versionId,
    versionName: snapshot.versionName,
    verdict: snapshot.verdict,
    verdictTitle: verdictTitle(snapshot.verdict),
    confidence: snapshot.confidence,
    confidenceTitle: confidenceTitle(snapshot.confidence),
    counts: snapshot.counts,
    signalCount: dossier.signals.length,
    topSignals: topSignals(dossier.signals),
    summary: snapshot.narrative,
    summaryVerified: snapshot.narrativeVerified,
    computedAt: snapshot.computedAt,
    versionReleased: snapshot.versionReleased,
    previousSnapshotId: snapshot.previousSnapshotId,
    coverage: snapshot.coverage,
  };
}

/** `list-release-signals`: detailed signals with proofs, optional severity filter. */
export async function listReleaseSignals(
  input: ListReleaseSignalsInput,
  deps: ActionDeps,
): Promise<ListReleaseSignalsOutput> {
  const dossier = await requireDossier(deps, input.versionId);
  const filter: Severity | null = input.severity ?? null;
  const selected = dossier.signals
    .filter((signal) => filter === null || signal.severity === filter)
    .sort(compareSignals);
  deps.logger.log('info', 'action.list-release-signals', {
    versionId: input.versionId,
    severity: filter,
    count: selected.length,
  });
  return {
    versionId: input.versionId,
    versionName: dossier.snapshot.versionName,
    verdict: dossier.snapshot.verdict,
    total: selected.length,
    counts: countBySeverity(selected),
    severityFilter: filter,
    signals: selected.map(toSignalView),
  };
}

/** The live waiver covering this signal, if any (closed/expired ones excluded). */
function liveWaiverOf(waivers: Waiver[], signal: Signal, now: string): Waiver | null {
  const waiver = waivers.find((candidate) => candidate.id === signal.waiverId);
  if (!waiver || waiver.closedAt || waiver.expiresAt <= now) return null;
  return waiver;
}

/** The project policy, or an explicit error: waiver rules are never guessed. */
export async function requirePolicy(deps: ActionDeps, projectId: string): Promise<Policy> {
  const policy = await deps.store.getPolicy(projectId);
  if (!policy) {
    throw new ActionError(
      'no-policy',
      `No policy configured for project ${projectId}: the waiver rules are unknown.`,
    );
  }
  return policy;
}

/** `explain-signal`: what was found, why it matters, how it can be cleared. */
export async function explainSignal(
  input: ExplainSignalInput,
  deps: ActionDeps,
): Promise<ExplainSignalOutput> {
  const located = await deps.index.findSignal(input.signalId);
  if (!located) {
    throw new ActionError('signal-unknown', `No signal with id "${input.signalId}" is recorded.`);
  }
  const { signal, versionId } = located;
  const definition = getSignalDefinition(signal.code);
  const dossier = await requireDossier(deps, versionId);
  const policy = await requirePolicy(deps, dossier.snapshot.projectId);
  const now = deps.clock.now();
  deps.logger.log('info', 'action.explain-signal', { signalId: signal.id, versionId });
  return {
    signalId: signal.id,
    versionId,
    code: signal.code,
    severity: signal.severity,
    status: signal.status,
    lot: definition.lot,
    title: definition.title,
    why: definition.why,
    finding: signal.finding,
    clear: definition.clear,
    source: definition.source,
    alwaysAvailable: definition.alwaysAvailable,
    evidence: signal.evidence.map((item) => ({ ...item })),
    waiver: liveWaiverOf(await deps.store.getWaivers(versionId), signal, now),
    canRequestWaiver: canViewerWaive(deps.viewer, policy),
    detectedAt: signal.detectedAt,
    firstSeenAt: signal.firstSeenAt,
  };
}

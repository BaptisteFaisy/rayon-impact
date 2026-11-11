import type { DetectionContext } from '../signals/context';
import { detectComp } from '../signals/comp';
import { detectQual } from '../signals/qual';
import { detectDep } from '../signals/dep';
import { detectExp } from '../signals/exp';
import { detectDoc } from '../signals/doc';
import { detectFuture } from '../signals/future';
import { applyMinorSampling, computeCoverage } from './coverage';
import { computeVerdict } from './verdict';
import {
  buildNarrativePayload,
  fallbackNarrative,
  isNarrativeUsable,
  NARRATIVE_MAX_ATTEMPTS,
  verifyNarrative,
} from './narrative';
import { computeOutcome } from './outcome';
import type { PipelineDeps, RecomputeRequest, RecomputeResult } from '../ports';
import { OUTCOME_WINDOW_HOURS } from '../types';
import type {
  Outcome,
  Policy,
  Signal,
  Snapshot,
} from '../types';

/**
 * Recompute pipeline: collect, detect, decide, write, store (SPEC §12).
 *
 * The five steps of the spec, in order. Every timestamp comes from the injected
 * clock, so the whole pipeline is deterministic in tests.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Runs every detector, in a stable order, and removes duplicates. */
export function detectAllSignals(ctx: DetectionContext): Signal[] {
  const families = [
    detectComp(ctx),
    detectQual(ctx),
    detectDep(ctx),
    detectExp(ctx),
    detectDoc(ctx),
    detectFuture(ctx),
  ];
  const seen = new Set<string>();
  const signals: Signal[] = [];
  for (const family of families) {
    for (const signal of family) {
      if (seen.has(signal.id)) continue;
      seen.add(signal.id);
      signals.push(signal);
    }
  }
  return sortSignals(signals);
}

/** Most severe first, then by code, then by subject: a stable reading order. */
function sortSignals(signals: Signal[]): Signal[] {
  const order = { blocking: 0, major: 1, minor: 2, info: 3 } as const;
  return [...signals].sort(
    (a, b) =>
      order[a.severity] - order[b.severity] ||
      a.code.localeCompare(b.code) ||
      a.subjectId.localeCompare(b.subjectId),
  );
}

function defaultPolicy(projectId: string): Policy {
  return {
    projectId,
    severityOverrides: {},
    disabledSignals: [],
    waiverApprovers: [],
    jsmProjectKeys: [],
    serviceMap: [],
    observationMode: false,
    defaultWaiverHours: 48,
  };
}

/** The policy of the project, or a neutral one when the project has none. */
export async function resolvePolicy(
  store: PipelineDeps['store'],
  projectId: string,
): Promise<Policy> {
  const stored = await store.getPolicy(projectId);
  return stored ?? defaultPolicy(projectId);
}

/** Signals of the previous snapshot, so `firstSeenAt` survives a recompute. */
async function previousSignals(
  deps: PipelineDeps,
  projectId: string,
): Promise<{ id: string | null; signals: Signal[] }> {
  const snapshots = await deps.store.listSnapshots(projectId, 1);
  const last = snapshots[0];
  if (!last) return { id: null, signals: [] };
  return { id: last.id, signals: await deps.store.getSignals(last.id) };
}

/**
 * Writes the summary with the language model, then checks it. Falls back to
 * the deterministic summary when the model fails or breaks the rules.
 */
interface WrittenNarrative {
  text: string;
  fromModel: boolean;
  /** Soft violations kept for the audit trail (`narrativeRejections`). */
  rejections: string[];
}

/**
 * Writes the summary with the language model, then checks it.
 *
 * A text citing something absent from the signals is never published (SPEC §8).
 * A truthful text whose layout is off is retried, then accepted: throwing away
 * an accurate summary because the model added a title would hide information.
 */
async function writeNarrative(
  deps: PipelineDeps,
  payload: { system: string; user: string },
  input: Parameters<typeof verifyNarrative>[1],
): Promise<WrittenNarrative> {
  let best: WrittenNarrative | null = null;

  for (let attempt = 1; attempt <= NARRATIVE_MAX_ATTEMPTS; attempt += 1) {
    try {
      const text = await deps.narrative.write(payload);
      if (!isNarrativeUsable(text)) continue;
      const check = verifyNarrative(text, input);

      if (!check.ok) {
        deps.logger.log('warn', 'synthèse rejetée : élément absent des signaux', {
          attempt,
          violations: check.hardViolations.slice(0, 3),
        });
        continue;
      }
      if (check.softViolations.length === 0) {
        return { text, fromModel: true, rejections: [] };
      }
      best ??= { text, fromModel: true, rejections: check.softViolations.slice(0, 3) };
      deps.logger.log('warn', 'synthèse juste mais hors format, nouvelle tentative', {
        attempt,
        violations: best.rejections,
      });
    } catch {
      deps.logger.log('warn', 'le modèle a échoué, nouvelle tentative', { attempt });
    }
  }

  if (best) return best;
  return { text: fallbackNarrative(input), fromModel: false, rejections: [] };
}

/**
 * Full recompute of one release: the dossier is written and stored, the
 * screens never read live data (SPEC §12).
 */
export async function recomputeRelease(
  deps: PipelineDeps,
  request: RecomputeRequest,
): Promise<RecomputeResult> {
  const startedAt = deps.clock.now();
  const policy = await resolvePolicy(deps.store, request.projectId);
  const waivers = await deps.store.getWaivers(request.versionId);
  const previous = await previousSignals(deps, request.projectId);

  const release = await deps.collector.collect(
    request.projectId,
    request.versionId,
    request.viewerAccountId ?? '',
  );

  // SPEC §12: the collection is cached with the dossier, with its date.
  await deps.store.saveCollection(request.versionId, release, release.collectedAt);

  const ctx: DetectionContext = {
    release,
    policy,
    now: startedAt,
    waivers,
    previousSignals: previous.signals,
    pastOutcomes: [],
  };

  const detected = detectAllSignals(ctx);
  const sampled = applyMinorSampling(detected, release.issues.length);
  const coverage = computeCoverage(release);
  const result = computeVerdict(sampled.signals, coverage, release);

  const narrativeInput = {
    signals: sampled.signals,
    verdict: result.verdict,
    confidence: result.confidence,
    coverage,
    versionName: release.version.name,
    projectKey: release.project.key,
    locale: 'en' as const,
    serviceNames: policy.serviceMap.map((entry) => entry.serviceName),
  };
  const payload = buildNarrativePayload(narrativeInput);
  const narrative = await writeNarrative(deps, payload, narrativeInput);

  const snapshot: Snapshot = {
    id: `${request.versionId}-${startedAt}`,
    projectId: request.projectId,
    projectKey: release.project.key,
    versionId: request.versionId,
    versionName: release.version.name,
    versionReleased: release.version.released,
    computedAt: startedAt,
    verdict: result.verdict,
    confidence: result.confidence,
    coverage,
    counts: result.counts,
    narrative: narrative.text,
    narrativeVerified: narrative.fromModel,
    narrativeRejections: narrative.rejections,
    graphCachedAt: release.graph?.fetchedAt ?? null,
    previousSnapshotId: previous.id,
  };

  await deps.store.saveSnapshot(snapshot, sampled.signals);

  const finishedAt = deps.clock.now();
  return {
    snapshot,
    signals: sampled.signals,
    narrativeFromModel: narrative.fromModel,
    durationMs: Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt)),
  };
}

/**
 * 72 hour outcome of a published release (RI-15). Returns `null` while the
 * window is not over yet: no outcome, no silence (SPEC §15).
 */
export async function recomputeOutcome(
  deps: PipelineDeps,
  request: RecomputeRequest,
): Promise<Outcome | null> {
  const now = deps.clock.now();
  const existing = await deps.store.getOutcome(request.versionId);
  if (existing) return existing;

  // La date de publication vient de la version elle-meme, pas du dossier : un
  // dossier est recalcule a chaque evenement, sa date n'est pas celle du deploy.
  const cached = await deps.store.getCollection(request.versionId);
  if (!cached) {
    deps.logger.log('warn', 'bilan 72 h impossible : aucune collecte en cache', {
      versionId: request.versionId,
    });
    return null;
  }
  const release = cached.release;
  const releasedAt = release.version.releaseDate;
  if (!release.version.released || !releasedAt) {
    deps.logger.log('info', 'bilan 72 h ignore : version non publiee', {
      versionId: request.versionId,
    });
    return null;
  }

  const services = [
    ...new Set(
      release.issues
        .map((issue) => issue.serviceId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const releasedMs = new Date(releasedAt).getTime();
  const windowStart = new Date(releasedMs).toISOString();
  const windowEnd = new Date(releasedMs + OUTCOME_WINDOW_HOURS * 3_600_000).toISOString();

  // Sans source d'incidents, pas de bilan : un bilan vide se lirait comme
  // « tout va bien ». On le dit, on ne l'ecrit pas.
  const collect = deps.collector.collectIncidents;
  if (!collect) {
    deps.logger.log('warn', "bilan 72 h impossible : aucune source d'incidents", {
      versionId: request.versionId,
    });
    return null;
  }
  const incidents = await collect(services, windowStart, windowEnd);
  const computed = computeOutcome({
    versionId: request.versionId,
    releasedAt,
    incidents,
    servicesImpacted: services,
    notes:
      incidents.length === 0
        ? 'Aucun incident cree sur les services touches dans les 72 h suivant la publication.'
        : `${incidents.length} incident(s) cree(s) dans les 72 h suivant la publication.`,
    now,
  });
  if (!computed) {
    deps.logger.log('info', 'bilan 72 h pas encore echu', { versionId: request.versionId });
    return null;
  }
  await deps.store.saveOutcome(computed);
  deps.logger.log('info', 'bilan 72 h calcule', {
    versionId: request.versionId,
    incidents: computed.incidents.length,
  });
  return computed;
}

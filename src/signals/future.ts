import type { Evidence, GraphFacts, OutcomeIncident, Signal } from '../types.js';
import type { DetectionContext, Detector } from './context.js';
import { isSignalEnabled, makeSignal } from './context.js';
import { impactedServices, serviceName } from './exp.js';

/**
 * Vision signals (lot C): HIST-01 and OBJ-01.
 *
 * Deliberately sober implementation. Both rest on sources the app cannot fully
 * read yet — past 72 h outcomes resolved down to a service, and an objective
 * milestone carried by the version in the Teamwork Graph — so each detector
 * stays silent rather than guessing. Silence is never reported as "all clear":
 * the coverage of the dossier says which source was missing (SPEC §15).
 *
 * Pure domain logic: no Forge imports, no side effects, deterministic.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/**
 * Service of an incident seen in a past outcome: the graph relation first
 * (`servicesByIncidentId`), then the JSM incident already collected for this
 * release when the same key shows up. Null = unresolved, so the incident is
 * left out of HIST-01 instead of being attributed to a wrong service.
 */
export function outcomeServiceId(
  ctx: DetectionContext,
  incident: OutcomeIncident,
): string | null {
  const fromGraph = ctx.release.graph?.servicesByIncidentId[incident.key];
  if (fromGraph) return fromGraph;
  const known = ctx.release.incidents.find((i) => i.key === incident.key);
  return known?.serviceId ?? null;
}

/**
 * Past incidents grouped by impacted service, across every stored 72 h
 * outcome. Each outcome already is a 72 h window (OUTCOME_WINDOW_HOURS), so
 * counting entries is counting incidents inside such a window.
 */
export function incidentsByService(ctx: DetectionContext): Map<string, OutcomeIncident[]> {
  const touched = impactedServices(ctx.release);
  const byService = new Map<string, OutcomeIncident[]>();
  for (const outcome of ctx.pastOutcomes) {
    for (const incident of outcome.incidents) {
      const serviceId = outcomeServiceId(ctx, incident);
      if (!serviceId || !touched.has(serviceId)) continue;
      const list = byService.get(serviceId) ?? [];
      list.push(incident);
      byService.set(serviceId, list);
    }
  }
  return byService;
}

/** Evidence for the first past incident that carries a url. */
function pastIncidentEvidence(incidents: OutcomeIncident[]): Evidence[] {
  const withUrl = incidents.find((i) => i.url);
  if (!withUrl?.url) return [];
  return [
    {
      subjectType: 'incident',
      subjectId: withUrl.key,
      label: { key: 'evidence.view' },
      url: withUrl.url,
    },
  ];
}

/**
 * HIST-01 (major): risk zone. One signal per impacted service whose past
 * releases produced at least one incident inside their 72 h window.
 * Empty `pastOutcomes` → nothing (the source is absent, coverage says so).
 */
function detectHist01(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('HIST-01', ctx.policy)) return [];
  const byService = incidentsByService(ctx);
  const signals: Signal[] = [];
  for (const serviceId of [...byService.keys()].sort()) {
    const incidents = byService.get(serviceId) ?? [];
    signals.push(
      makeSignal(ctx, {
        code: 'HIST-01',
        subject: { subjectType: 'service', subjectId: serviceId },
        finding: {
          key: 'signal.hist01.finding',
          params: { service: serviceName(ctx, serviceId), count: incidents.length },
        },
        evidence: pastIncidentEvidence(incidents),
      }),
    );
  }
  return signals;
}

/** What OBJ-01 needs once the graph exposes it: a milestone and its due date. */
export interface ObjectiveFacts {
  milestone: string;
  due: string;
}

/**
 * Reads the objective carried by the release out of the cached graph facts.
 *
 * Lot C reserve: `GraphFacts` exposes no objective relation today, and
 * `src/types.ts` is a shared contract this module must not extend. The reader
 * therefore looks for an optional `objective` member and returns null while it
 * is absent, so OBJ-01 stays silent instead of inventing a milestone
 * (SPEC §15). Plugging it in later = adding the field to `GraphFacts` and
 * dropping the cast below; nothing else here changes.
 */
export function objectiveFacts(graph: GraphFacts | null): ObjectiveFacts | null {
  if (!graph) return null;
  const candidate = (graph as unknown as { objective?: Partial<ObjectiveFacts> }).objective;
  if (!candidate?.milestone || !candidate.due) return null;
  return { milestone: candidate.milestone, due: candidate.due };
}

/**
 * OBJ-01 (info): the version carries an approaching objective milestone.
 * Informational only — it never weighs on the go/no-go (SPEC §7).
 */
function detectObj01(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('OBJ-01', ctx.policy)) return [];
  const facts = objectiveFacts(ctx.release.graph);
  if (!facts) return [];
  return [
    makeSignal(ctx, {
      code: 'OBJ-01',
      subject: { subjectType: 'version', subjectId: ctx.release.version.id },
      finding: {
        key: 'signal.obj01.finding',
        params: { milestone: facts.milestone, due: facts.due },
      },
      // Graph-sourced signal: no stable url for a milestone yet (lot C).
      evidence: [],
    }),
  ];
}

/** Both vision detectors in catalog order. */
export const futureDetectors: Detector[] = [detectHist01, detectObj01];

/** Runs all vision detectors against the given context. */
export function detectFuture(ctx: DetectionContext): Signal[] {
  return futureDetectors.flatMap((detector) => detector(ctx));
}

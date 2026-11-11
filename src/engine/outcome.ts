import {
  OUTCOME_WINDOW_HOURS,
  type Incident,
  type MessageRef,
  type Outcome,
  type OutcomeIncident,
  type Severity,
} from '../types';

export interface OutcomeInput {
  versionId: string;
  releasedAt: string;
  incidents: Incident[];
  servicesImpacted: string[];
  rollback?: boolean;
  notes?: string;
  now: string;
}

function matchesImpactedService(
  inc: Incident,
  servicesImpacted: string[],
): boolean {
  if (inc.serviceId && servicesImpacted.includes(inc.serviceId)) {
    return true;
  }
  if (inc.serviceName && servicesImpacted.includes(inc.serviceName)) {
    return true;
  }
  return false;
}

function resolveDurationMinutes(
  createdAtIso: string,
  resolvedAtIso?: string,
): number | undefined {
  if (!resolvedAtIso) {
    return undefined;
  }
  const createdMs = new Date(createdAtIso).getTime();
  const resolvedMs = new Date(resolvedAtIso).getTime();
  const diffMs = resolvedMs - createdMs;
  return Math.max(0, Math.round(diffMs / 60_000));
}

function toOutcomeIncident(inc: Incident): OutcomeIncident {
  const severity: Severity = inc.majorIncident ? 'major' : 'minor';
  const duration = resolveDurationMinutes(inc.createdAt, inc.resolvedAt);
  return {
    key: inc.key,
    severity,
    ...(duration !== undefined ? { resolvedAfterMinutes: duration } : {}),
    ...(inc.url ? { url: inc.url } : {}),
  };
}

function isInWindow(
  inc: Incident,
  releasedMs: number,
  windowEndMs: number,
): boolean {
  const createdMs = new Date(inc.createdAt).getTime();
  return createdMs >= releasedMs && createdMs <= windowEndMs;
}

export function computeOutcome(input: OutcomeInput): Outcome | null {
  const releasedMs = new Date(input.releasedAt).getTime();
  const windowEndMs = releasedMs + OUTCOME_WINDOW_HOURS * 3_600_000;
  const nowMs = new Date(input.now).getTime();

  if (nowMs < windowEndMs) {
    return null;
  }

  const relevantIncidents = input.incidents
    .filter(
      (inc) =>
        isInWindow(inc, releasedMs, windowEndMs) &&
        matchesImpactedService(inc, input.servicesImpacted),
    )
    .map(toOutcomeIncident);

  return {
    versionId: input.versionId,
    checkedAt: input.now,
    incidents: relevantIncidents,
    rollback: input.rollback ?? false,
    notes: input.notes ?? '',
  };
}

export function outcomeSummary(outcome: Outcome): MessageRef {
  const total = outcome.incidents.length;
  const majorCount = outcome.incidents.filter(
    (i) => i.severity === 'major',
  ).length;
  const minorCount = total - majorCount;
  return {
    key: total === 0 ? 'outcome.summary.clean' : 'outcome.summary.incidents',
    params: {
      count: total,
      majorCount,
      minorCount,
      rollback: outcome.rollback ? 1 : 0,
    },
  };
}

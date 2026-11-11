import type {
  CollectedRelease,
  Evidence,
  FreezeWindow,
  Incident,
  JiraVersion,
  Signal,
} from '../types';
import { RECENT_INCIDENT_DAYS } from '../types';
import type { DetectionContext, Detector } from './context';
import { daysBetween, isSignalEnabled, makeSignal } from './context';

/**
 * EXP signal family: exploitation and incidents (SPEC §7).
 *
 * Everything here depends on the ticket → service mapping: an incident or a
 * freeze window only counts when it lands on a service the release touches.
 * A ticket without a known service is never dropped silently — coverage
 * reports it (SPEC §7, §15); it simply cannot raise an EXP signal.
 *
 * Pure domain logic: no Forge imports, no side effects, deterministic.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Services the release touches: the non-null `serviceId` of its tickets. */
export function impactedServices(release: CollectedRelease): Set<string> {
  const ids = new Set<string>();
  for (const issue of release.issues) {
    if (issue.serviceId) ids.add(issue.serviceId);
  }
  return ids;
}

/** Keys of the release tickets touching one service (EXP-01 `issues` param). */
export function issueKeysForService(release: CollectedRelease, serviceId: string): string[] {
  return release.issues.filter((i) => i.serviceId === serviceId).map((i) => i.key);
}

/**
 * Human-readable service name: the project service map wins (it is operator
 * data), then whatever the release already knows, then the raw id.
 */
export function serviceName(ctx: DetectionContext, serviceId: string): string {
  const mapped = ctx.policy.serviceMap.find((s) => s.serviceId === serviceId);
  if (mapped) return mapped.serviceName;
  const issue = ctx.release.issues.find((i) => i.serviceId === serviceId && i.serviceName);
  if (issue?.serviceName) return issue.serviceName;
  const incident = ctx.release.incidents.find((i) => i.serviceId === serviceId && i.serviceName);
  return incident?.serviceName ?? serviceId;
}

/**
 * Calendar day of an ISO timestamp, so date-only and full ISO compare alike.
 * Shared with the DOC family (zero duplication: no second copy elsewhere).
 */
export function isoDay(iso: string): string {
  return iso.slice(0, 10);
}

/** Evidence pointing at an incident, with its JSM url. */
function incidentEvidence(incident: Incident): Evidence {
  return {
    subjectType: 'incident',
    subjectId: incident.subjectId,
    label: { key: 'evidence.view' },
    url: incident.url,
  };
}

/**
 * EXP-01 (blocking): open incident on an impacted service.
 * An incident without a service is ignored (SPEC §16) — coverage says so.
 */
function detectExp01(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('EXP-01', ctx.policy)) return [];
  const touched = impactedServices(ctx.release);
  const signals: Signal[] = [];
  for (const incident of ctx.release.incidents) {
    if (incident.state !== 'open') continue;
    if (!incident.serviceId || !touched.has(incident.serviceId)) continue;
    signals.push(
      makeSignal(ctx, {
        code: 'EXP-01',
        subject: { subjectType: 'incident', subjectId: incident.subjectId },
        finding: {
          key: 'signal.exp01.finding',
          params: {
            incidentKey: incident.key,
            service: serviceName(ctx, incident.serviceId),
            issues: issueKeysForService(ctx.release, incident.serviceId).join(', '),
          },
        },
        evidence: [incidentEvidence(incident)],
      }),
    );
  }
  return signals;
}

/**
 * EXP-02 (major): incident resolved less than RECENT_INCIDENT_DAYS ago on an
 * impacted service. `days` is floored; a resolution in the future is ignored.
 */
function detectExp02(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('EXP-02', ctx.policy)) return [];
  const touched = impactedServices(ctx.release);
  const signals: Signal[] = [];
  for (const incident of ctx.release.incidents) {
    if (incident.state === 'open' || !incident.resolvedAt) continue;
    if (!incident.serviceId || !touched.has(incident.serviceId)) continue;
    const days = daysBetween(incident.resolvedAt, ctx.now);
    if (days < 0 || days >= RECENT_INCIDENT_DAYS) continue;
    signals.push(
      makeSignal(ctx, {
        code: 'EXP-02',
        subject: { subjectType: 'incident', subjectId: incident.subjectId },
        finding: {
          key: 'signal.exp02.finding',
          params: {
            incidentKey: incident.key,
            days: Math.floor(days),
            service: serviceName(ctx, incident.serviceId),
          },
        },
        evidence: [incidentEvidence(incident)],
      }),
    );
  }
  return signals;
}

/** The freeze window covering `date` for at least one impacted service. */
function freezeCovering(
  freezes: FreezeWindow[],
  date: string,
  touched: Set<string>,
): FreezeWindow | undefined {
  const day = isoDay(date);
  return freezes.find((freeze) => {
    if (day < isoDay(freeze.from) || day > isoDay(freeze.to)) return false;
    if (freeze.scope === 'all') return true;
    return (freeze.serviceIds ?? []).some((id) => touched.has(id));
  });
}

/**
 * EXP-03 (blocking): the planned release date falls inside a freeze window.
 * A version without a release date raises nothing (SPEC §16). One signal at
 * most: the first matching window keeps the subject id stable.
 */
function detectExp03(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('EXP-03', ctx.policy)) return [];
  const releaseDate = ctx.release.version.releaseDate;
  if (!releaseDate) return [];
  const freeze = freezeCovering(
    ctx.release.freezeWindows,
    releaseDate,
    impactedServices(ctx.release),
  );
  if (!freeze) return [];
  return [
    makeSignal(ctx, {
      code: 'EXP-03',
      subject: { subjectType: 'version', subjectId: ctx.release.version.id },
      finding: {
        key: 'signal.exp03.finding',
        params: {
          date: isoDay(releaseDate),
          freezeName: freeze.name,
          from: isoDay(freeze.from),
          to: isoDay(freeze.to),
        },
      },
      evidence: [],
    }),
  ];
}

/** Services shared by the release and one sibling version, in a stable order. */
function sharedServices(
  ctx: DetectionContext,
  sibling: JiraVersion,
  touched: Set<string>,
): string[] {
  const siblingIssues = ctx.release.issuesOfSiblingVersions[sibling.id] ?? [];
  const shared = new Set<string>();
  for (const issue of siblingIssues) {
    if (issue.serviceId && touched.has(issue.serviceId)) shared.add(issue.serviceId);
  }
  return [...shared].sort();
}

/**
 * EXP-04 (major): another version ships the same day on the same services.
 * One signal per sibling version (the subject), services joined in the param.
 * A version without a release date raises nothing (SPEC §16).
 */
function detectExp04(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('EXP-04', ctx.policy)) return [];
  const releaseDate = ctx.release.version.releaseDate;
  if (!releaseDate) return [];
  const touched = impactedServices(ctx.release);
  if (touched.size === 0) return [];
  const signals: Signal[] = [];
  for (const sibling of ctx.release.siblingVersions) {
    if (sibling.id === ctx.release.version.id) continue;
    if (!sibling.releaseDate || isoDay(sibling.releaseDate) !== isoDay(releaseDate)) continue;
    const shared = sharedServices(ctx, sibling, touched);
    if (shared.length === 0) continue;
    signals.push(
      makeSignal(ctx, {
        code: 'EXP-04',
        subject: { subjectType: 'version', subjectId: sibling.id },
        finding: {
          key: 'signal.exp04.finding',
          params: {
            siblingVersion: sibling.name,
            date: isoDay(releaseDate),
            service: shared.map((id) => serviceName(ctx, id)).join(', '),
          },
        },
        // Jira versions expose no url: nothing to link, coverage still counts.
        evidence: [],
      }),
    );
  }
  return signals;
}

/** All 4 EXP detectors in catalog order. */
export const expDetectors: Detector[] = [
  detectExp01,
  detectExp02,
  detectExp03,
  detectExp04,
];

/** Runs all EXP detectors against the given context. */
export function detectExp(ctx: DetectionContext): Signal[] {
  return expDetectors.flatMap((detector) => detector(ctx));
}

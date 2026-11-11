import type {
  CollectedRelease,
  Evidence,
  GraphFacts,
  IssueLinkRef,
  JiraIssue,
  Policy,
  ServiceMapEntry,
  Signal,
  Team,
} from '../types';
import type { DetectionContext, Detector } from './context';
import { isSignalEnabled, makeSignal } from './context';
import { DEFAULT_JIRA_DOMAIN, makeIssueEvidence } from './comp';

/**
 * DEP signal family: dependencies around the release (SPEC §7).
 *
 *   DEP-01 (blocking) a release ticket is blocked by a ticket still open;
 *   DEP-02 (major)    a ticket of another project depends on this version;
 *   DEP-03 (minor)    a service touched by the release has no ticket from its
 *                     owning team.
 *
 * DEP-01 and DEP-02 read Jira issue links only; DEP-03 needs the Teamwork Graph
 * and stays silent when the graph block is absent — a missing source is never
 * read as good news (SPEC §15, §16 "aucun dépôt relié" spirit).
 *
 * `resolveServiceId` is exported so the EXP/HIST families resolve a ticket's
 * service the same way instead of recopying the SPEC §7 mapping order.
 *
 * Pure domain logic: no Forge import, no I/O, no real clock.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Jira link types carrying a "blocks" meaning, in any language/casing. */
const BLOCKING_LINK_PATTERN = /block|bloqu/i;

function isBlockingLinkType(type: string): boolean {
  return BLOCKING_LINK_PATTERN.test(type);
}

/** The first link of this ticket that blocks it while the target is still open. */
function openBlockerLink(issue: JiraIssue): IssueLinkRef | undefined {
  return issue.links.find(
    (link) =>
      isBlockingLinkType(link.type) &&
      (link.targetStatusCategory ?? 'unknown') !== 'done',
  );
}

/** Proof pointing at the blocker, found in the release or outside it. */
function blockerEvidence(release: CollectedRelease, link: IssueLinkRef): Evidence {
  const known = [...release.issues, ...release.linkedOutsideIssues].find(
    (issue) => issue.subjectId === link.targetId || issue.key === link.targetKey,
  );
  if (known) return makeIssueEvidence(release, known);
  const domain = `${link.targetProjectKey.toLowerCase()}.${DEFAULT_JIRA_DOMAIN}`;
  return {
    subjectType: 'issue',
    subjectId: link.targetId,
    label: { key: 'evidence.view' },
    url: `https://${domain}/browse/${link.targetKey}`,
  };
}

/**
 * DEP-01 (blocking): a release ticket is blocked by a ticket still open.
 * One signal per ticket (stable id), carrying the blocker as second proof.
 * Params: `key`, `blockerKey`, `blockerStatus`.
 */
export function detectDep01(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('DEP-01', ctx.policy)) return [];
  const signals: Signal[] = [];
  for (const issue of ctx.release.issues) {
    const blocker = openBlockerLink(issue);
    if (!blocker) continue;
    signals.push(
      makeSignal(ctx, {
        code: 'DEP-01',
        subject: { subjectType: 'issue', subjectId: issue.subjectId },
        finding: {
          key: 'signal.dep01.finding',
          params: {
            key: issue.key,
            blockerKey: blocker.targetKey,
            blockerStatus: blocker.targetStatusCategory ?? 'unknown',
          },
        },
        evidence: [
          makeIssueEvidence(ctx.release, issue),
          blockerEvidence(ctx.release, blocker),
        ],
      }),
    );
  }
  return signals;
}

/** The release ticket an outside issue points at, if any (DEP-02). */
function releaseTicketLinkedFrom(
  outside: JiraIssue,
  release: CollectedRelease,
): JiraIssue | undefined {
  return outside.links
    .map((link) =>
      release.issues.find(
        (issue) =>
          issue.subjectId === link.targetId || issue.key === link.targetKey,
      ),
    )
    .find((issue): issue is JiraIssue => issue !== undefined);
}

/**
 * DEP-02 (major): a ticket of another project depends on this version.
 * One signal per outside ticket, whose subject is that outside ticket.
 * Params: `key` (release ticket), `targetKey`, `projectKey`.
 */
export function detectDep02(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('DEP-02', ctx.policy)) return [];
  const signals: Signal[] = [];
  for (const outside of ctx.release.linkedOutsideIssues) {
    if (outside.projectKey === ctx.release.project.key) continue;
    const target = releaseTicketLinkedFrom(outside, ctx.release);
    if (!target) continue;
    signals.push(
      makeSignal(ctx, {
        code: 'DEP-02',
        subject: { subjectType: 'issue', subjectId: outside.subjectId },
        finding: {
          key: 'signal.dep02.finding',
          params: {
            key: target.key,
            targetKey: outside.key,
            projectKey: outside.projectKey,
          },
        },
        evidence: [makeIssueEvidence(ctx.release, outside)],
      }),
    );
  }
  return signals;
}

function matchService(
  policy: Policy,
  predicate: (entry: ServiceMapEntry) => boolean,
): string | null {
  return policy.serviceMap.find(predicate)?.serviceId ?? null;
}

/**
 * Resolves the service a ticket touches, following the SPEC §7 order:
 *   1. the graph relation "Jira work item impacts Compass component";
 *   2. the "affected services" field, then the Jira component field;
 *   3. the app mapping table, matched on the graph Compass component;
 *   4. the service the collector already resolved, else null (lowers coverage).
 */
export function resolveServiceId(
  issue: JiraIssue,
  policy: Policy,
  graph: GraphFacts | null,
): string | null {
  const fromGraph = graph?.servicesByIssueId[issue.subjectId];
  if (fromGraph) return fromGraph;

  const affected = issue.affectedServices;
  const byAffected = matchService(policy, (entry) =>
    [entry.serviceName, entry.serviceId, entry.jsmService].some(
      (name) => name !== undefined && affected.includes(name),
    ),
  );
  if (byAffected) return byAffected;

  const byComponent = matchService(
    policy,
    (entry) =>
      entry.jiraComponent !== undefined &&
      issue.components.includes(entry.jiraComponent),
  );
  if (byComponent) return byComponent;

  const compassComponents = graph?.componentsByIssueId[issue.subjectId] ?? [];
  const byCompass = matchService(
    policy,
    (entry) =>
      entry.compassComponentId !== undefined &&
      compassComponents.includes(entry.compassComponentId),
  );
  if (byCompass) return byCompass;

  return issue.serviceId ?? null;
}

/** Every team the graph or the collection knows about, deduplicated by id. */
function knownTeams(release: CollectedRelease): Team[] {
  const byId = new Map<string, Team>();
  for (const team of release.teams) byId.set(team.id, team);
  for (const teams of Object.values(release.graph?.teamsByIssueId ?? {})) {
    for (const team of teams) byId.set(team.id, team);
  }
  return [...byId.values()];
}

/** Teams already holding a ticket of this release. */
function linkedTeamIds(release: CollectedRelease): Set<string> {
  const issueIds = new Set(release.issues.map((issue) => issue.subjectId));
  const linked = new Set<string>();
  for (const [issueId, teams] of Object.entries(
    release.graph?.teamsByIssueId ?? {},
  )) {
    if (!issueIds.has(issueId)) continue;
    for (const team of teams) linked.add(team.id);
  }
  return linked;
}

/** Services touched by the release, from the tickets and the graph components. */
function touchedServiceIds(ctx: DetectionContext): Set<string> {
  const { release, policy } = ctx;
  const touched = new Set<string>();
  for (const issue of release.issues) {
    const serviceId = resolveServiceId(issue, policy, release.graph);
    if (serviceId) touched.add(serviceId);
    const components = release.graph?.componentsByIssueId[issue.subjectId] ?? [];
    for (const component of components) {
      const entry = policy.serviceMap.find(
        (candidate) => candidate.compassComponentId === component,
      );
      if (entry) touched.add(entry.serviceId);
    }
  }
  return touched;
}

/** Teams owning a service, matched on its Compass or Jira component id. */
function owningTeams(entry: ServiceMapEntry, teams: Team[]): Team[] {
  const componentIds = [entry.compassComponentId, entry.jiraComponent].filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  return teams.filter((team) =>
    componentIds.some((id) => team.componentIds.includes(id)),
  );
}

/**
 * DEP-03 (minor): a service touched by the release whose owning team has no
 * linked ticket. Silent without the graph (SPEC §15, §16) and for a service
 * whose owning team is unknown: an absent fact is not a finding.
 * Param: `service`.
 */
export function detectDep03(ctx: DetectionContext): Signal[] {
  if (!isSignalEnabled('DEP-03', ctx.policy)) return [];
  if (ctx.release.graph === null) return [];
  const linked = linkedTeamIds(ctx.release);
  const teams = knownTeams(ctx.release);
  const signals: Signal[] = [];
  for (const serviceId of touchedServiceIds(ctx)) {
    const entry = ctx.policy.serviceMap.find(
      (candidate) => candidate.serviceId === serviceId,
    );
    if (!entry) continue;
    const owners = owningTeams(entry, teams);
    if (owners.length === 0) continue;
    if (owners.some((owner) => linked.has(owner.id))) continue;
    signals.push(
      makeSignal(ctx, {
        code: 'DEP-03',
        subject: { subjectType: 'service', subjectId: serviceId },
        finding: {
          key: 'signal.dep03.finding',
          params: { service: entry.serviceName },
        },
        evidence: [
          {
            subjectType: 'service',
            subjectId: serviceId,
            label: { key: 'evidence.view' },
          },
        ],
      }),
    );
  }
  return signals;
}

/** All 3 DEP detectors in catalogue order. */
export const depDetectors: Detector[] = [detectDep01, detectDep02, detectDep03];

/** Runs every DEP detector, each one already filtering its disabled code. */
export function detectDep(ctx: DetectionContext): Signal[] {
  return depDetectors.flatMap((detector) => detector(ctx));
}

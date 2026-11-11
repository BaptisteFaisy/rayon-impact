/**
 * Impact and aftermath actions: `list-impacted-teams`, `get-release-outcome`
 * (SPEC §10).
 *
 * Teams, services and linked tickets come from the collection cached with the
 * dossier (SPEC §12); the verdict and the decision come from the dossier. When
 * nothing was ever collected the answer is an empty, dated list — never an
 * invented team, never "nobody is impacted".
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { latestDecision } from '../engine/decision.js';
import { outcomeSummary } from '../engine/outcome.js';
import type { CollectedRelease, ImpactedTeam, JiraIssue, Team } from '../types.js';
import { requireDossier } from './release.js';
import type {
  ActionDeps,
  GetReleaseOutcomeInput,
  GetReleaseOutcomeOutput,
  ImpactedServiceView,
  ImpactedTicketView,
  ListImpactedTeamsInput,
  ListImpactedTeamsOutput,
} from './types.js';

/** How a team was found, most trustworthy first. */
const VIA_RANK: Record<ImpactedTeam['via'], number> = { graph: 0, link: 1, component: 2 };

/** Every team known for this release: collected list plus graph attachments. */
function teamRegistry(release: CollectedRelease): Map<string, Team> {
  const registry = new Map<string, Team>();
  for (const team of release.teams) registry.set(team.id, team);
  for (const teams of Object.values(release.graph?.teamsByIssueId ?? {})) {
    for (const team of teams) {
      if (!registry.has(team.id)) registry.set(team.id, team);
    }
  }
  return registry;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** Teams owning one ticket: graph first, then the Compass component map. */
function teamsForIssue(
  issue: JiraIssue,
  release: CollectedRelease,
  registry: Map<string, Team>,
): { teamIds: string[]; via: ImpactedTeam['via'] } {
  const fromGraph = (release.graph?.teamsByIssueId[issue.subjectId] ?? []).map((team) => team.id);
  if (fromGraph.length > 0) return { teamIds: dedupe(fromGraph), via: 'graph' };
  const componentIds = new Set([
    ...issue.components,
    ...(release.graph?.componentsByIssueId[issue.subjectId] ?? []),
  ]);
  const fromComponents = [...registry.values()]
    .filter((team) => team.componentIds.some((id) => componentIds.has(id)))
    .map((team) => team.id);
  if (fromComponents.length > 0) return { teamIds: dedupe(fromComponents), via: 'component' };
  return { teamIds: [], via: 'component' };
}

interface TeamAccumulator {
  teamId: string;
  teamName: string;
  via: ImpactedTeam['via'];
  services: Map<string, string>;
  issues: { key: string; summary: string; projectKey: string }[];
}

function addToTeam(
  accumulators: Map<string, TeamAccumulator>,
  registry: Map<string, Team>,
  issue: JiraIssue,
  found: { teamIds: string[]; via: ImpactedTeam['via'] },
): void {
  for (const teamId of found.teamIds) {
    const team = registry.get(teamId);
    const entry = accumulators.get(teamId) ?? {
      teamId,
      teamName: team?.name ?? teamId,
      via: found.via,
      services: new Map<string, string>(),
      issues: [],
    };
    if (VIA_RANK[found.via] < VIA_RANK[entry.via]) entry.via = found.via;
    if (issue.serviceId) entry.services.set(issue.serviceId, issue.serviceName ?? issue.serviceId);
    entry.issues.push({ key: issue.key, summary: issue.summary, projectKey: issue.projectKey });
    accumulators.set(teamId, entry);
  }
}

function collectTeams(release: CollectedRelease): Map<string, TeamAccumulator> {
  const registry = teamRegistry(release);
  const accumulators = new Map<string, TeamAccumulator>();
  for (const issue of release.issues) {
    addToTeam(accumulators, registry, issue, teamsForIssue(issue, release, registry));
  }
  for (const outside of release.linkedOutsideIssues) {
    const found = teamsForIssue(outside, release, registry);
    addToTeam(accumulators, registry, outside, { teamIds: found.teamIds, via: 'link' });
  }
  return accumulators;
}

function toTeamViews(accumulators: Map<string, TeamAccumulator>): ImpactedTeam[] {
  return [...accumulators.values()]
    .map((entry) => ({
      teamId: entry.teamId,
      teamName: entry.teamName,
      services: [...entry.services].map(([serviceId, serviceName]) => ({ serviceId, serviceName })),
      issues: entry.issues,
      via: entry.via,
    }))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
}

/** One entry per service touched by the release, with its teams and tickets. */
function toServiceViews(release: CollectedRelease, teams: ImpactedTeam[]): ImpactedServiceView[] {
  const services = new Map<string, ImpactedServiceView>();
  const ensure = (issue: JiraIssue): ImpactedServiceView | null => {
    if (!issue.serviceId) return null;
    const entry = services.get(issue.serviceId) ?? {
      serviceId: issue.serviceId,
      serviceName: issue.serviceName ?? issue.serviceId,
      teamIds: [],
      issueKeys: [],
    };
    services.set(issue.serviceId, entry);
    return entry;
  };
  for (const issue of [...release.issues, ...release.linkedOutsideIssues]) {
    const entry = ensure(issue);
    if (!entry) continue;
    entry.issueKeys = dedupe([...entry.issueKeys, issue.key]);
    const owners = teams.filter((team) =>
      team.issues.some((candidate) => candidate.key === issue.key),
    );
    entry.teamIds = dedupe([...entry.teamIds, ...owners.map((team) => team.teamId)]);
  }
  return [...services.values()].sort((a, b) => a.serviceName.localeCompare(b.serviceName));
}

function toTicketViews(release: CollectedRelease, teams: ImpactedTeam[]): ImpactedTicketView[] {
  const describe = (issue: JiraIssue, inRelease: boolean): ImpactedTicketView => ({
    key: issue.key,
    summary: issue.summary,
    projectKey: issue.projectKey,
    serviceId: issue.serviceId,
    teamIds: teams
      .filter((team) => team.issues.some((candidate) => candidate.key === issue.key))
      .map((team) => team.teamId),
    inRelease,
  });
  return [
    ...release.issues.map((issue) => describe(issue, true)),
    ...release.linkedOutsideIssues.map((issue) => describe(issue, false)),
  ];
}

/** `list-impacted-teams`: teams, services and linked tickets of one version. */
export async function listImpactedTeams(
  input: ListImpactedTeamsInput,
  deps: ActionDeps,
): Promise<ListImpactedTeamsOutput> {
  const dossier = await requireDossier(deps, input.versionId);
  const facts = await deps.index.getFacts(input.versionId);
  const base = {
    versionId: input.versionId,
    versionName: dossier.snapshot.versionName,
    coverage: dossier.snapshot.coverage,
  };
  if (!facts) {
    deps.logger.log('warn', 'action.list-impacted-teams.no-facts', { versionId: input.versionId });
    return { ...base, teams: [], services: [], tickets: [], factsCachedAt: null };
  }
  const teams = toTeamViews(collectTeams(facts.release));
  deps.logger.log('info', 'action.list-impacted-teams', {
    versionId: input.versionId,
    teams: teams.length,
  });
  return {
    ...base,
    teams,
    services: toServiceViews(facts.release, teams),
    tickets: toTicketViews(facts.release, teams),
    factsCachedAt: facts.cachedAt,
  };
}

/** `get-release-outcome`: the decision that was taken and the 72 h aftermath. */
export async function getReleaseOutcome(
  input: GetReleaseOutcomeInput,
  deps: ActionDeps,
): Promise<GetReleaseOutcomeOutput> {
  const dossier = await requireDossier(deps, input.versionId);
  const decision = latestDecision(dossier.decisions);
  const outcome = dossier.outcome;
  deps.logger.log('info', 'action.get-release-outcome', {
    versionId: input.versionId,
    hasDecision: decision !== null,
    hasOutcome: outcome !== null,
  });
  return {
    versionId: input.versionId,
    versionName: dossier.snapshot.versionName,
    verdict: dossier.snapshot.verdict,
    versionReleased: dossier.snapshot.versionReleased,
    decision: decision
      ? {
          id: decision.id,
          kind: decision.decision,
          decidedBy: decision.decidedBy,
          decidedAt: decision.decidedAt,
          verdictAtDecision: decision.verdictAtDecision,
          ...(decision.note === undefined ? {} : { note: decision.note }),
        }
      : null,
    outcome: outcome
      ? {
          checkedAt: outcome.checkedAt,
          incidents: outcome.incidents.map((incident) => ({ ...incident })),
          rollback: outcome.rollback,
          notes: outcome.notes,
          summary: outcomeSummary(outcome),
        }
      : null,
  };
}

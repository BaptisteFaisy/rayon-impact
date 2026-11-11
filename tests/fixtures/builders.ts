import type {
  CollectedRelease,
  ConfluencePage,
  Coverage,
  DevSummary,
  GraphFacts,
  Incident,
  JiraIssue,
  JiraProject,
  JiraVersion,
  Policy,
  Snapshot,
  SourceStatus,
  Team,
} from '../../src/types';

/**
 * Fixture builders: every test file composes its dataset from these defaults
 * instead of re-declaring object literals (no duplication, one source of truth).
 *
 * Defaults describe a healthy release: no signal should fire on a bare
 * `issue('PAY-1')` + `collected({ issues: [...] })`.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export const PROJECT_KEY = 'PAY';

export function healthyDev(partial: Partial<DevSummary> = {}): DevSummary {
  return {
    known: true,
    commits: 1,
    openPullRequests: 0,
    mergedPullRequests: 1,
    mergedWithoutApproval: 0,
    failingBuilds: 0,
    lastBuildState: 'success',
    ...partial,
  };
}

export function unknownDev(): DevSummary {
  return {
    known: false,
    commits: 0,
    openPullRequests: 0,
    mergedPullRequests: 0,
    mergedWithoutApproval: 0,
    failingBuilds: 0,
  };
}

export function issue(key: string, partial: Partial<JiraIssue> = {}): JiraIssue {
  const id = partial.subjectId ?? `id-${key.toLowerCase()}`;
  return {
    subjectType: 'issue',
    subjectId: id,
    key,
    summary: `${key} summary`,
    statusName: 'Done',
    statusCategory: 'done',
    issueType: 'Story',
    projectKey: partial.projectKey ?? PROJECT_KEY,
    components: partial.components ?? ['checkout-api'],
    affectedServices: [],
    fixVersions: partial.fixVersions ?? ['2.4'],
    reopenedDuringCycle: false,
    links: [],
    remoteLinks: [],
    dev: partial.dev ?? healthyDev(),
    serviceId: partial.serviceId !== undefined ? partial.serviceId : 'svc-checkout-api',
    serviceName: partial.serviceName ?? 'checkout-api',
    ...partial,
  };
}

export function project(partial: Partial<JiraProject> = {}): JiraProject {
  return {
    id: 'proj-pay',
    key: PROJECT_KEY,
    name: 'Paiements',
    versionsEnabled: true,
    ...partial,
  };
}

export function version(partial: Partial<JiraVersion> = {}): JiraVersion {
  return {
    id: 'ver-24',
    name: '2.4',
    projectId: 'proj-pay',
    released: false,
    archived: false,
    releaseDate: '2026-11-12',
    startDate: '2026-10-29',
    ...partial,
  };
}

export function incident(key: string, partial: Partial<Incident> = {}): Incident {
  const id = partial.subjectId ?? `inc-${key.toLowerCase()}`;
  return {
    subjectType: 'incident',
    subjectId: id,
    key,
    summary: `${key} summary`,
    state: 'open',
    majorIncident: false,
    serviceId: partial.serviceId !== undefined ? partial.serviceId : 'svc-checkout-api',
    serviceName: partial.serviceName ?? 'checkout-api',
    createdAt: '2026-11-10T08:00:00.000Z',
    url: `https://pay.atlassian.net/browse/${key}`,
    ...partial,
  };
}

export function page(id: string, partial: Partial<ConfluencePage> = {}): ConfluencePage {
  return {
    subjectType: 'page',
    subjectId: id,
    title: partial.title ?? `Page ${id}`,
    url: `https://pay.atlassian.net/wiki/pages/${id}`,
    spaceKey: 'PAY',
    lastModified: '2026-11-10T09:00:00.000Z',
    ...partial,
  };
}

export function team(id: string, partial: Partial<Team> = {}): Team {
  return {
    id,
    name: partial.name ?? `Team ${id}`,
    componentIds: partial.componentIds ?? [],
    ...partial,
  };
}

export function graphFacts(partial: Partial<GraphFacts> = {}): GraphFacts {
  return {
    fetchedAt: '2026-11-11T06:00:00.000Z',
    fetchedByAccountId: 'user-release-lead',
    devByIssueId: {},
    servicesByIssueId: {},
    teamsByIssueId: {},
    componentsByIssueId: {},
    servicesByIncidentId: {},
    missingScopes: [],
    ...partial,
  };
}

export function okSources(): SourceStatus[] {
  return [
    { source: 'jira', state: 'ok' },
    { source: 'development', state: 'ok' },
    { source: 'teamwork-graph', state: 'ok' },
    { source: 'jsm', state: 'ok' },
    { source: 'confluence', state: 'ok' },
    { source: 'service-map', state: 'ok' },
  ];
}

export function collected(partial: Partial<CollectedRelease> = {}): CollectedRelease {
  return {
    project: partial.project ?? project(),
    version: partial.version ?? version(),
    issues: partial.issues ?? [],
    linkedOutsideIssues: partial.linkedOutsideIssues ?? [],
    incidents: partial.incidents ?? [],
    pages: partial.pages ?? [],
    teams: partial.teams ?? [],
    graph: partial.graph !== undefined ? partial.graph : graphFacts(),
    siblingVersions: partial.siblingVersions ?? [],
    issuesOfSiblingVersions: partial.issuesOfSiblingVersions ?? {},
    freezeWindows: partial.freezeWindows ?? [],
    cycleStartedAt: partial.cycleStartedAt ?? '2026-10-29T00:00:00.000Z',
    collectedAt: partial.collectedAt ?? '2026-11-11T06:00:00.000Z',
    sources: partial.sources ?? okSources(),
  };
}

export function policy(partial: Partial<Policy> = {}): Policy {
  return {
    projectId: 'proj-pay',
    severityOverrides: {},
    disabledSignals: [],
    waiverApprovers: ['user-release-lead'],
    jsmProjectKeys: ['INC'],
    serviceMap: [
      {
        serviceId: 'svc-checkout-api',
        serviceName: 'checkout-api',
        jiraComponent: 'checkout-api',
        compassComponentId: 'cmp-checkout',
        jsmService: 'checkout-api',
      },
    ],
    observationMode: false,
    defaultWaiverHours: 48,
    ...partial,
  };
}

export function fullCoverage(issueCount: number, partial: Partial<Coverage> = {}): Coverage {
  return {
    issueCount,
    issuesWithCode: issueCount,
    issuesWithService: issueCount,
    codeRatio: issueCount === 0 ? 0 : 1,
    serviceRatio: issueCount === 0 ? 0 : 1,
    sources: okSources(),
    sampledMinorSignals: false,
    notes: [],
    ...partial,
  };
}

export function snapshot(partial: Partial<Snapshot> = {}): Snapshot {
  const issueCount = partial.coverage?.issueCount ?? 0;
  return {
    id: 'snap-1',
    projectId: 'proj-pay',
    projectKey: PROJECT_KEY,
    versionId: 'ver-24',
    versionName: '2.4',
    versionReleased: false,
    computedAt: '2026-11-11T06:00:00.000Z',
    verdict: 'go',
    confidence: 'high',
    coverage: fullCoverage(issueCount),
    counts: { blocking: 0, major: 0, minor: 0, info: 0 },
    narrative: 'All clear.',
    narrativeVerified: true,
    narrativeRejections: [],
    graphCachedAt: '2026-11-11T06:00:00.000Z',
    previousSnapshotId: null,
    ...partial,
  };
}

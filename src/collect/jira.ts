/**
 * Jira release collector: turns one version into a `CollectedRelease`.
 *
 * An adapter over `JiraClient` (src/collect/jira-client.ts), the only module
 * touching `@forge/api`; the collector therefore runs unchanged against
 * `createFakeJiraClient` in tests.
 *
 * What it gathers, per SPEC §7 and R5:
 *   - the project and whether the Versions feature is there (SPEC §16);
 *   - the version, and its unreleased siblings shipping the same day (EXP-04);
 *   - the tickets, via `fixVersion = "<name>"`, paginated, capped at MAX_ISSUES
 *     with an honest `partial` source above it (SPEC §15);
 *   - `issuelinks` (DEP-01/02) and the tickets outside the project that link
 *     to the release (DEP-02);
 *   - Confluence remote links (DOC-01) and, when a resolver is injected, the
 *     pages themselves;
 *   - the changelog for `addedToVersionAt` (COMP-04) and the reopen history
 *     (QUAL-03);
 *   - development information from the Teamwork Graph when a cached block is
 *     supplied, else from the JQL `development[...]` fallback (R5 §3);
 *   - incidents, only through an injected JSM source (R5 §4.6: incidents are
 *     Jira issues, but the "affected services" field id is undocumented).
 *
 * Honesty rule (SPEC §15): a source that fails is `unavailable` with a detail,
 * never silently "empty". States only ever degrade, never recover.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { Clock, ReleaseCollector } from '../ports.js';
import { ISSUE_SAMPLE_THRESHOLD } from '../types.js';
import type {
  CollectedRelease,
  ConfluencePage,
  DevSummary,
  GraphFacts,
  Incident,
  IssueLinkRef,
  JiraIssue,
  JiraProject,
  JiraVersion,
  Policy,
  RemoteLink,
  SourceName,
  SourceState,
  SourceStatus,
} from '../types.js';
import { sourceStatus } from './paging.js';
import type { JiraClient, JiraIssuePayload, JiraVersionPayload } from './jira-client.js';
import {
  devFromJql,
  sameDay,
  searchAllPages,
  toJiraIssue,
  toJiraVersion,
  toRemoteLink,
} from './jira-client.js';

/** Hard ceiling from SPEC §15: above it the app samples minor signals. */
export const MAX_ISSUES = ISSUE_SAMPLE_THRESHOLD;

const PAGE_SIZE = 100;
const MAX_SIBLING_VERSIONS = 5;
const MAX_SIBLING_ISSUES = 200;
const MAX_LINKED_OUTSIDE = 100;

const ISSUE_FIELDS = [
  'summary',
  'status',
  'issuetype',
  'project',
  'components',
  'fixVersions',
  'issuelinks',
  'assignee',
];

const SOURCE_ORDER: readonly SourceName[] = [
  'jira',
  'development',
  'teamwork-graph',
  'jsm',
  'confluence',
  'service-map',
];

const SOURCE_LABEL: Record<SourceName, string> = {
  jira: 'signal.source.jira',
  development: 'signal.source.dev',
  'teamwork-graph': 'signal.source.graph',
  jsm: 'signal.source.jsm',
  confluence: 'signal.source.confluence',
  compass: 'signal.source.compass',
  'service-map': 'signal.source.compass',
};

const UNKNOWN_DEV: DevSummary = {
  known: false,
  commits: 0,
  openPullRequests: 0,
  mergedPullRequests: 0,
  mergedWithoutApproval: 0,
  failingBuilds: 0,
};

/* ------------------------------------------------------ source tracking */

type StatusMap = Map<SourceName, SourceStatus>;

/** Worst-first: a state only ever degrades, so a failure never heals. */
const STATE_RANK: readonly SourceState[] = ['ok', 'partial', 'empty', 'unavailable'];
function mark(
  map: StatusMap,
  source: SourceName,
  state: SourceState,
  detailKey?: string,
): void {
  const current = map.get(source);
  if (current && STATE_RANK.indexOf(current.state) >= STATE_RANK.indexOf(state)) return;
  const status = sourceStatus(source, state);
  map.set(source, detailKey === undefined ? status : { ...status, detail: { key: detailKey } });
}

/** Every source in a stable order; one never touched stays `unavailable`. */
function statuses(map: StatusMap): SourceStatus[] {
  return SOURCE_ORDER.map((source) => {
    const status = map.get(source);
    if (status) return status;
    return { source, state: 'unavailable', detail: { key: SOURCE_LABEL[source] } };
  });
}

/** Cycle start: the version start date, else the earliest known addition. */
function cycleStartOf(version: JiraVersion, issues: JiraIssue[]): string | undefined {
  if (version.startDate) return version.startDate;
  return issues
    .map((issue) => issue.addedToVersionAt)
    .filter((value): value is string => value !== undefined)
    .sort()[0];
}

/* -------------------------------------------------------------- options */

export interface JiraCollectorOptions {
  client: JiraClient;
  policy: Policy;
  /** Cached Teamwork Graph block; `null`/absent → JQL fallback (SPEC §12). */
  graph?: GraphFacts | null;
  clock?: Clock;
  /** Custom field id of "affected services" (undocumented, R5 §4.6). */
  affectedServicesFieldId?: string;
  /** Confluence metadata for the linked pages (DOC-01); absent → `partial`. */
  pageResolver?: (links: RemoteLink[]) => Promise<ConfluencePage[]>;
  /** JSM incidents for the watched projects (EXP-01/02). */
  incidentSource?: (projectKeys: string[]) => Promise<Incident[]>;
}

/* ------------------------------------------------------------ collector */

export class JiraReleaseCollector implements ReleaseCollector {
  private readonly options: JiraCollectorOptions;
  private readonly client: JiraClient;
  private readonly policy: Policy;
  private readonly graph: GraphFacts | null;
  private readonly clock: Clock;

  constructor(options: JiraCollectorOptions) {
    this.options = options;
    this.client = options.client;
    this.policy = options.policy;
    this.graph = options.graph ?? null;
    this.clock = options.clock ?? { now: () => new Date().toISOString() };
  }

  async collect(
    projectId: string,
    versionId: string,
    _viewerAccountId: string,
  ): Promise<CollectedRelease> {
    const sources: StatusMap = new Map();
    mark(sources, 'service-map', this.policy.serviceMap.length === 0 ? 'empty' : 'ok');

    const { project, versions } = await this.loadProject(projectId, sources);
    const version = await this.loadVersion(versionId, projectId, sources);
    if (!version) return this.emptyRelease(project, projectId, versionId, sources);

    const issues = await this.loadIssues(project, version, sources);
    await this.attachRemoteLinks(issues, sources);
    const linkedOutsideIssues = await this.loadLinkedOutside(project, issues, sources);
    const siblings = await this.loadSiblings(project, version, versions, sources);

    return {
      project,
      version,
      issues,
      linkedOutsideIssues,
      incidents: await this.loadIncidents(sources),
      pages: await this.loadPages(issues, sources),
      teams: [],
      graph: this.graph,
      siblingVersions: siblings.versions,
      issuesOfSiblingVersions: siblings.issues,
      freezeWindows: [],
      cycleStartedAt: cycleStartOf(version, issues),
      collectedAt: this.clock.now(),
      sources: statuses(sources),
    };
  }

  /** Mapping context shared by every payload → `JiraIssue` of this run. */
  private context(dev: DevSummary, versionName: string, cycleStart?: string) {
    return {
      policy: this.policy,
      graph: this.graph,
      dev,
      versionName,
      cycleStart,
      affectedFieldId: this.options.affectedServicesFieldId,
    };
  }

  private async loadProject(
    projectId: string,
    sources: StatusMap,
  ): Promise<{ project: JiraProject; versions: JiraVersionPayload[] }> {
    try {
      const payload = await this.client.getProject(projectId);
      let versions: JiraVersionPayload[] = [];
      let versionsOk = true;
      try {
        versions = await this.client.listProjectVersions(payload.id);
      } catch {
        versionsOk = false;
        mark(sources, 'jira', 'partial', 'signal.source.jiraVersions');
      }
      // R5 documents no "has versions" flag: team-managed projects are the
      // documented gap (SPEC §16), and a failing versions call says so.
      return {
        project: {
          id: payload.id,
          key: payload.key,
          name: payload.name,
          versionsEnabled: payload.simplified !== true && versionsOk,
        },
        versions,
      };
    } catch {
      mark(sources, 'jira', 'unavailable', 'signal.source.jira');
      return {
        project: { id: projectId, key: '', name: projectId, versionsEnabled: false },
        versions: [],
      };
    }
  }

  private async loadVersion(
    versionId: string,
    projectId: string,
    sources: StatusMap,
  ): Promise<JiraVersion | null> {
    try {
      return toJiraVersion(await this.client.getVersion(versionId), projectId);
    } catch {
      mark(sources, 'jira', 'unavailable', 'signal.source.jira');
      return null;
    }
  }

  /** `expand=changelog` is not always honoured: fetch what is missing. */
  private async backfillChangelogs(payloads: JiraIssuePayload[]): Promise<number> {
    let missing = 0;
    for (const payload of payloads) {
      if (payload.changelog) continue;
      try {
        const full = await this.client.getIssue(payload.id, ['changelog']);
        if (full.changelog) payload.changelog = full.changelog;
        else missing += 1;
      } catch {
        missing += 1;
      }
    }
    return missing;
  }

  private async loadIssues(
    project: JiraProject,
    version: JiraVersion,
    sources: StatusMap,
  ): Promise<JiraIssue[]> {
    const jql = `project = "${project.key}" AND fixVersion = "${version.name}"`;
    const affected = this.options.affectedServicesFieldId;
    const fields = affected ? [...ISSUE_FIELDS, affected] : ISSUE_FIELDS;
    try {
      const { issues: payloads, truncated } = await searchAllPages(
        this.client,
        jql,
        fields,
        MAX_ISSUES,
        ['changelog'],
        PAGE_SIZE,
      );
      if ((await this.backfillChangelogs(payloads)) > 0) {
        mark(sources, 'jira', 'partial', 'signal.source.jiraHistory');
      }
      if (truncated) mark(sources, 'jira', 'partial', 'signal.source.jira');
      const dev = await this.devSummaries(payloads, sources);
      mark(sources, 'jira', payloads.length === 0 ? 'empty' : 'ok');
      return payloads.map((payload) =>
        toJiraIssue(
          payload,
          this.context(dev.get(payload.id) ?? UNKNOWN_DEV, version.name, version.startDate),
        ),
      );
    } catch {
      mark(sources, 'jira', 'unavailable', 'signal.source.jira');
      return [];
    }
  }

  private async devSummaries(
    payloads: JiraIssuePayload[],
    sources: StatusMap,
  ): Promise<Map<string, DevSummary>> {
    const fromGraph = this.graph?.devByIssueId;
    if (fromGraph) {
      mark(sources, 'development', 'ok');
      mark(sources, 'teamwork-graph', 'ok');
      return new Map(payloads.map((payload) => [payload.id, fromGraph[payload.id] ?? UNKNOWN_DEV]));
    }
    const fallback = await devFromJql(
      this.client,
      payloads.map((payload) => payload.key),
    );
    if (!fallback) {
      mark(sources, 'development', 'unavailable', 'signal.source.dev');
      return new Map();
    }
    const empty = payloads.length === 0;
    mark(sources, 'development', empty ? 'empty' : 'partial', empty ? undefined : 'signal.source.dev');
    return new Map(payloads.map((payload) => [payload.id, fallback.get(payload.key) ?? UNKNOWN_DEV]));
  }

  private async attachRemoteLinks(issues: JiraIssue[], sources: StatusMap): Promise<void> {
    let failed = 0;
    for (const issue of issues) {
      try {
        const payloads = await this.client.getRemoteLinks(issue.subjectId);
        issue.remoteLinks = payloads
          .map(toRemoteLink)
          .filter((link): link is RemoteLink => link !== null);
      } catch {
        failed += 1;
      }
    }
    if (failed === 0 || issues.length === 0) return;
    mark(
      sources,
      'confluence',
      failed === issues.length ? 'unavailable' : 'partial',
      'signal.source.confluence',
    );
  }

  private async loadPages(issues: JiraIssue[], sources: StatusMap): Promise<ConfluencePage[]> {
    const links = issues
      .flatMap((issue) => issue.remoteLinks)
      .filter((link) => link.kind === 'confluence');
    const resolver = this.options.pageResolver;
    if (!resolver) {
      mark(
        sources,
        'confluence',
        links.length === 0 ? 'empty' : 'partial',
        links.length === 0 ? undefined : 'signal.source.confluence',
      );
      return [];
    }
    try {
      const pages = await resolver(links);
      mark(sources, 'confluence', pages.length === 0 ? 'empty' : 'ok');
      return pages;
    } catch {
      mark(sources, 'confluence', 'unavailable', 'signal.source.confluence');
      return [];
    }
  }

  private async loadIncidents(sources: StatusMap): Promise<Incident[]> {
    const source = this.options.incidentSource;
    if (!source || this.policy.jsmProjectKeys.length === 0) {
      mark(sources, 'jsm', 'unavailable', 'signal.source.jsm');
      return [];
    }
    try {
      const incidents = await source(this.policy.jsmProjectKeys);
      mark(sources, 'jsm', incidents.length === 0 ? 'empty' : 'ok');
      return incidents;
    } catch {
      mark(sources, 'jsm', 'unavailable', 'signal.source.jsm');
      return [];
    }
  }

  /** Tickets of another project pointing at the release (DEP-02). */
  private async loadLinkedOutside(
    project: JiraProject,
    issues: JiraIssue[],
    sources: StatusMap,
  ): Promise<JiraIssue[]> {
    const targets = new Map<string, IssueLinkRef>();
    for (const issue of issues) {
      for (const link of issue.links) {
        if (link.targetProjectKey === project.key || targets.has(link.targetId)) continue;
        targets.set(link.targetId, link);
      }
    }
    const outside: JiraIssue[] = [];
    let failed = 0;
    for (const targetId of [...targets.keys()].slice(0, MAX_LINKED_OUTSIDE)) {
      try {
        const payload = await this.client.getIssue(targetId, ['issuelinks']);
        outside.push(toJiraIssue(payload, this.context(UNKNOWN_DEV, '')));
      } catch {
        failed += 1;
      }
    }
    if (failed > 0) mark(sources, 'jira', 'partial', 'signal.source.jiraLinks');
    return outside;
  }

  private async loadSiblings(
    project: JiraProject,
    version: JiraVersion,
    versions: JiraVersionPayload[],
    sources: StatusMap,
  ): Promise<{ versions: JiraVersion[]; issues: Record<string, JiraIssue[]> }> {
    const siblings = versions
      .filter(
        (candidate) =>
          candidate.id !== version.id &&
          candidate.archived !== true &&
          candidate.released !== true &&
          sameDay(candidate.releaseDate, version.releaseDate),
      )
      .slice(0, MAX_SIBLING_VERSIONS)
      .map((candidate) => toJiraVersion(candidate, project.id));
    const issues: Record<string, JiraIssue[]> = {};
    for (const sibling of siblings) {
      issues[sibling.id] = await this.loadSiblingIssues(project, sibling, sources);
    }
    return { versions: siblings, issues };
  }

  private async loadSiblingIssues(
    project: JiraProject,
    sibling: JiraVersion,
    sources: StatusMap,
  ): Promise<JiraIssue[]> {
    const jql = `project = "${project.key}" AND fixVersion = "${sibling.name}"`;
    try {
      const { issues } = await searchAllPages(
        this.client,
        jql,
        ISSUE_FIELDS,
        MAX_SIBLING_ISSUES,
        undefined,
        PAGE_SIZE,
      );
      return issues.map((payload) => toJiraIssue(payload, this.context(UNKNOWN_DEV, sibling.name)));
    } catch {
      mark(sources, 'jira', 'partial', 'signal.source.jiraVersions');
      return [];
    }
  }

  /** The version could not be read: report it, never pretend it is empty. */
  private emptyRelease(
    project: JiraProject,
    projectId: string,
    versionId: string,
    sources: StatusMap,
  ): CollectedRelease {
    return {
      project,
      version: { id: versionId, name: '', projectId, released: false, archived: false },
      issues: [],
      linkedOutsideIssues: [],
      incidents: [],
      pages: [],
      teams: [],
      graph: this.graph,
      siblingVersions: [],
      issuesOfSiblingVersions: {},
      freezeWindows: [],
      collectedAt: this.clock.now(),
      sources: statuses(sources),
    };
  }
}

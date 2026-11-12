/**
 * Narrow, injectable façade over the Jira REST API: transport, payload shapes,
 * query strategy (pagination, JQL `development[...]`) and the mapping of Jira
 * payloads to the domain types of src/types.ts.
 *
 * This is one of the two modules allowed to import `@forge/api` (CONVENTIONS §2,
 * with src/collect/graph.ts). Everything above it — the collector, the service
 * resolution, the tests — talks to the `JiraClient` interface instead, so the
 * whole collection path runs against an in-memory fake (src/collect/jira-fake.ts)
 * with no network and no Forge runtime.
 *
 * Endpoints and scopes: docs/research/R5-scopes-data-apis.md §4.2 (search/jql,
 * cursor pagination), §4.3 (changelog via `expand=changelog`), §4.4 (issuelinks),
 * §4.5 (remotelink), §3 (JQL `development[...]`), §1.2 (comment needs
 * `write:jira-work`; everything else `read:jira-work`).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import api, { assumeTrustedRoute, route } from '@forge/api';
import type { RequestInit } from '@forge/api';
import type {
  DevSummary,
  GraphFacts,
  IssueLinkRef,
  IssueStatusCategory,
  JiraIssue,
  JiraVersion,
  Policy,
  RemoteLink,
} from '../types';
import { MAX_PAGE_FETCHES, readJson, pathLabel } from './paging';
import type { ForgeRequest, ForgeResponseLike } from './paging';
import { resolveServiceForIssue } from './services';

/* ------------------------------------------------------- payload shapes */

export interface JiraStatusPayload {
  name?: string;
  statusCategory?: { key?: string; name?: string };
}

export interface JiraLinkedIssuePayload {
  id: string;
  key: string;
  fields?: {
    project?: { id?: string; key?: string };
    status?: JiraStatusPayload;
    fixVersions?: { id?: string; name?: string }[];
  };
}

export interface JiraIssueLinkPayload {
  id: string;
  type: { name: string; inward?: string; outward?: string };
  inwardIssue?: JiraLinkedIssuePayload;
  outwardIssue?: JiraLinkedIssuePayload;
}

export interface JiraChangelogPayload {
  histories: {
    created: string;
    items: { field: string; fieldId?: string; toString?: string | null }[];
  }[];
}

/** Only the fields the app reads; Jira returns much more. */
export interface JiraFieldsPayload {
  summary?: string;
  status?: JiraStatusPayload;
  issuetype?: { name?: string };
  project?: { id?: string; key?: string };
  components?: { id?: string; name?: string }[];
  fixVersions?: { id?: string; name?: string }[];
  issuelinks?: JiraIssueLinkPayload[];
  assignee?: { accountId?: string } | null;
  /** Custom fields ("affected services", …) are addressed by `customfield_*`. */
  [customField: string]: unknown;
}

export interface JiraIssuePayload {
  id: string;
  key: string;
  fields: JiraFieldsPayload;
  /** Present only when the search asked for `expand=changelog` (R5 §4.3). */
  changelog?: JiraChangelogPayload;
}

export interface JiraRemoteLinkPayload {
  id: string | number;
  object?: { url?: string; title?: string };
}

export interface JiraProjectPayload {
  id: string;
  key: string;
  name: string;
  /** Team-managed project; the Versions feature is not always there (SPEC §16). */
  simplified?: boolean;
}

export interface JiraVersionPayload {
  id: string;
  name: string;
  projectId?: string | number;
  released?: boolean;
  archived?: boolean;
  releaseDate?: string;
  startDate?: string;
}

/** One page of `/rest/api/3/search/jql` (cursor pagination, R5 §4.2). */
export interface JiraSearchPage {
  issues: JiraIssuePayload[];
  nextPageToken?: string;
}

/* ------------------------------------------------------------ interface */

/** Every Jira call the collector needs, and nothing else. */
export interface JiraClient {
  /** One page of a JQL search; pass `pageToken` to walk the cursor. */
  searchJql(
    jql: string,
    fields: string[],
    max: number,
    pageToken?: string,
    expand?: string[],
  ): Promise<JiraSearchPage>;
  getVersion(versionId: string): Promise<JiraVersionPayload>;
  getIssue(issueId: string, expand?: string[]): Promise<JiraIssuePayload>;
  listProjectVersions(projectId: string): Promise<JiraVersionPayload[]>;
  getRemoteLinks(issueId: string): Promise<JiraRemoteLinkPayload[]>;
  addComment(issueId: string, text: string): Promise<void>;
  getProject(projectId: string): Promise<JiraProjectPayload>;
}

/** Typed failure: callers turn it into an `unavailable` source, never "empty". */
export class JiraApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'JiraApiError';
  }
}

export interface JiraClientOptions {
  /** `app` (default) for background collection, `user` for a viewer's rights. */
  as?: 'app' | 'user';
  /** Required with `as: 'user'` for offline impersonation (R5 §2.2). */
  accountId?: string;
}

/* ------------------------------------------------------------- transport */

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  };
}

/** Jira v3 comments take Atlassian Document Format, not a plain string. */
export function textToAdf(text: string): Record<string, unknown> {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

export function createJiraClient(options: JiraClientOptions = {}): JiraClient {
  const send = (options.as === 'user' ? api.asUser(options.accountId) : api.asApp()).requestJira;

  /** Shared with the other collectors: a non-2xx answer becomes a typed error. */
  const call = async <T>(label: string, url: Parameters<typeof send>[0], init?: RequestInit) =>
    readJson<T>(await send(url, init), label);

  return {
    searchJql(jql, fields, max, pageToken, expand) {
      const body: Record<string, unknown> = { jql, fields, maxResults: max };
      if (pageToken) body.nextPageToken = pageToken;
      if (expand?.length) body.expand = expand.join(',');
      return call('searchJql', route`/rest/api/3/search/jql`, jsonInit('POST', body));
    },
    getVersion: (versionId) =>
      call('getVersion', route`/rest/api/3/version/${versionId}`, jsonInit('GET')),
    getIssue: (issueId, expand) =>
      call(
        'getIssue',
        route`/rest/api/3/issue/${issueId}?expand=${expand?.length ? expand.join(',') : ''}`,
        jsonInit('GET'),
      ),
    listProjectVersions: (projectId) =>
      call('listProjectVersions', route`/rest/api/3/project/${projectId}/versions`, jsonInit('GET')),
    getRemoteLinks: (issueId) =>
      call('getRemoteLinks', route`/rest/api/3/issue/${issueId}/remotelink`, jsonInit('GET')),
    getProject: (projectId) =>
      call('getProject', route`/rest/api/3/project/${projectId}`, jsonInit('GET')),
    async addComment(issueId, text) {
      await call(
        'addComment',
        route`/rest/api/3/issue/${issueId}/comment`,
        jsonInit('POST', { body: textToAdf(text) }),
      );
    },
  };
}

const SAFE_JIRA_PATH = /^\/rest\/api\/3\/[A-Za-z0-9\-._~/%?=&]*$/;

/**
 * The same authenticated transport, shaped as the `ForgeRequest` port that
 * src/collect/jsm.ts and src/collect/confluence.ts consume: they build their
 * paths at runtime, so they cannot use a `route` template. The path is checked
 * here — absolute, under `/rest/api/3/`, no `..`, no `//` — before it reaches
 * `assumeTrustedRoute`, which is why this adapter lives beside the transport.
 */
export function createJiraForgeRequest(options: JiraClientOptions = {}): ForgeRequest {
  const send = (options.as === 'user' ? api.asUser(options.accountId) : api.asApp()).requestJira;
  return async (path, init): Promise<ForgeResponseLike> => {
    // `path` peut être une chaîne ou une `route` de Forge : le contrôle de
    // sûreté porte sur la forme lisible, dans les deux cas.
    const label = pathLabel(path);
    if (!SAFE_JIRA_PATH.test(label) || label.includes('..') || label.includes('//')) {
      throw new JiraApiError(`refusing unsafe Jira path: ${label}`, 400);
    }
    return send(assumeTrustedRoute(label), init as RequestInit);
  };
}

/* ------------------------------------------------------------ query strategy */

export interface SearchResult {
  issues: JiraIssuePayload[];
  /** True when the cap was hit: something was left behind (SPEC §15). */
  truncated: boolean;
}

/** Walks the `nextPageToken` cursor, never past `max` (R5 §4.2). */
export async function searchAllPages(
  client: JiraClient,
  jql: string,
  fields: string[],
  max: number,
  expand?: string[],
  pageSize = 100,
): Promise<SearchResult> {
  const issues: JiraIssuePayload[] = [];
  let token: string | undefined;
  for (let pages = 0; pages < MAX_PAGE_FETCHES; pages += 1) {
    const room = max - issues.length;
    if (room <= 0) return { issues, truncated: true };
    const page = await client.searchJql(jql, fields, Math.min(pageSize, room), token, expand);
    issues.push(...page.issues.slice(0, room));
    token = page.nextPageToken;
    if (!token) return { issues, truncated: false };
  }
  return { issues, truncated: true };
}

/** Development JQL aliases, exactly as documented in R5 §3. */
export const DEV_CLAUSES = {
  commits: 'development[commits].all',
  openPullRequests: 'development[pullrequests].open',
  pullRequests: 'development[pullrequests].all',
  failingBuilds: 'development[builds].failing > 0',
} as const;

const DEV_JQL_CHUNK = 100;

/**
 * Development information from the JQL fallback (SPEC §12, R5 §3), used when
 * the Teamwork Graph block is absent. Those clauses only *filter* ("has
 * commits", "has an open PR"), so counts are 0/1 and reviewers are invisible:
 * QUAL-02 stays silent and the caller reports `development` as `partial`.
 * `null` when the fallback itself is unavailable.
 */
export async function devFromJql(
  client: JiraClient,
  keys: string[],
): Promise<Map<string, DevSummary> | null> {
  const hits: Record<keyof typeof DEV_CLAUSES, Set<string>> = {
    commits: new Set(),
    openPullRequests: new Set(),
    pullRequests: new Set(),
    failingBuilds: new Set(),
  };
  try {
    for (const clause of Object.keys(DEV_CLAUSES) as (keyof typeof DEV_CLAUSES)[]) {
      for (const group of chunk(keys, DEV_JQL_CHUNK)) {
        const jql = `key in (${group.join(', ')}) AND ${DEV_CLAUSES[clause]}`;
        const page = await client.searchJql(jql, ['key'], group.length);
        for (const issue of page.issues) hits[clause].add(issue.key);
      }
    }
  } catch {
    return null;
  }
  const dev = new Map<string, DevSummary>();
  for (const key of keys) {
    const failing = hits.failingBuilds.has(key);
    const open = hits.openPullRequests.has(key);
    dev.set(key, {
      known: true,
      commits: hits.commits.has(key) ? 1 : 0,
      openPullRequests: open ? 1 : 0,
      mergedPullRequests: hits.pullRequests.has(key) && !open ? 1 : 0,
      mergedWithoutApproval: 0,
      failingBuilds: failing ? 1 : 0,
      lastBuildState: failing ? 'failing' : 'unknown',
    });
  }
  return dev;
}

/* ------------------------------------------------------- normalisation */

const CATEGORY_BY_KEY: Record<string, IssueStatusCategory> = {
  new: 'to-do',
  indeterminate: 'in-progress',
  done: 'done',
};

export function statusCategoryOf(status?: JiraStatusPayload): IssueStatusCategory {
  const key = status?.statusCategory?.key;
  return (key === undefined ? undefined : CATEGORY_BY_KEY[key]) ?? 'to-do';
}

/** One `issuelinks` entry, seen from the issue that carries it. */
export function toLinkRef(link: JiraIssueLinkPayload): IssueLinkRef | null {
  const other = link.inwardIssue ?? link.outwardIssue;
  if (!other) return null;
  return {
    id: link.id,
    type: link.type.name,
    inward: link.inwardIssue !== undefined,
    targetKey: other.key,
    targetId: other.id,
    targetProjectKey: other.fields?.project?.key ?? other.key.split('-')[0] ?? '',
    targetStatusCategory: other.fields?.status
      ? statusCategoryOf(other.fields.status)
      : undefined,
    targetFixVersions: (other.fields?.fixVersions ?? [])
      .map((entry) => entry.name ?? '')
      .filter((name) => name.length > 0),
  };
}

const CONFLUENCE_URL = /\/wiki\//i;

export function toRemoteLink(payload: JiraRemoteLinkPayload): RemoteLink | null {
  const url = payload.object?.url;
  if (!url) return null;
  return {
    id: String(payload.id),
    url,
    title: payload.object?.title ?? url,
    kind: CONFLUENCE_URL.test(url) ? 'confluence' : 'other',
  };
}

const FIX_VERSION_FIELD = /fix ?version/i;
const STATUS_FIELD = /^status$/i;
const REOPENED = /reopen/i;

function changelogDates(
  payload: JiraIssuePayload,
  matches: (item: { field: string; fieldId?: string; toString?: string | null }) => boolean,
): string[] {
  return (payload.changelog?.histories ?? [])
    .filter((history) => history.items.some(matches))
    .map((history) => history.created)
    .sort();
}

/** Earliest changelog entry that put the ticket into this version (COMP-04). */
export function addedToVersionAt(
  payload: JiraIssuePayload,
  versionName: string,
): string | undefined {
  if (!versionName) return undefined;
  return changelogDates(
    payload,
    (item) =>
      (FIX_VERSION_FIELD.test(item.field) || item.fieldId === 'fixVersions') &&
      (item.toString ?? '').includes(versionName),
  )[0];
}

/** Earliest changelog entry that reopened the ticket (QUAL-03). */
export function reopenedAt(payload: JiraIssuePayload): string | undefined {
  return changelogDates(
    payload,
    (item) => STATUS_FIELD.test(item.field) && REOPENED.test(item.toString ?? ''),
  )[0];
}

/** "Affected services" custom field: string, array or `{ value }` objects. */
export function affectedServicesOf(payload: JiraIssuePayload, fieldId?: string): string[] {
  if (!fieldId) return [];
  const raw = payload.fields[fieldId];
  return (Array.isArray(raw) ? raw : [raw])
    .map((value) => {
      if (typeof value === 'string') return value;
      const named = value as { value?: string; name?: string } | null;
      return named?.value ?? named?.name ?? '';
    })
    .filter((name) => name.length > 0);
}

export interface IssueMappingContext {
  policy: Policy;
  graph: GraphFacts | null;
  /** Development summary, from the graph or the JQL fallback. */
  dev: DevSummary;
  /** Version under collection: scopes `addedToVersionAt`. */
  versionName: string;
  /** Release cycle start: scopes `reopenedDuringCycle`. */
  cycleStart?: string;
  /** Custom field id of "affected services" (undocumented, R5 §4.6). */
  affectedFieldId?: string;
}

/**
 * Jira payload → `JiraIssue`. The service is resolved here, through the single
 * implementation of SPEC §7 (src/collect/services.ts): no caller re-derives it.
 */
export function toJiraIssue(payload: JiraIssuePayload, ctx: IssueMappingContext): JiraIssue {
  const fields = payload.fields;
  const reopened = reopenedAt(payload);
  const issue: JiraIssue = {
    subjectType: 'issue',
    subjectId: payload.id,
    key: payload.key,
    summary: fields.summary ?? '',
    statusName: fields.status?.name ?? '',
    statusCategory: statusCategoryOf(fields.status),
    issueType: fields.issuetype?.name ?? '',
    projectKey: fields.project?.key ?? '',
    assigneeAccountId: fields.assignee?.accountId,
    components: (fields.components ?? [])
      .map((component) => component.name ?? '')
      .filter((name) => name.length > 0),
    affectedServices: affectedServicesOf(payload, ctx.affectedFieldId),
    fixVersions: (fields.fixVersions ?? [])
      .map((entry) => entry.name ?? '')
      .filter((name) => name.length > 0),
    addedToVersionAt: addedToVersionAt(payload, ctx.versionName),
    reopenedDuringCycle:
      reopened !== undefined && (ctx.cycleStart === undefined || reopened >= ctx.cycleStart),
    links: (fields.issuelinks ?? [])
      .map(toLinkRef)
      .filter((link): link is IssueLinkRef => link !== null),
    remoteLinks: [],
    dev: ctx.dev,
    serviceId: null,
  };
  const resolved = resolveServiceForIssue(issue, ctx.policy, ctx.graph);
  issue.serviceId = resolved.serviceId;
  if (resolved.serviceName !== undefined) issue.serviceName = resolved.serviceName;
  return issue;
}

export function toJiraVersion(payload: JiraVersionPayload, projectId: string): JiraVersion {
  return {
    id: payload.id,
    name: payload.name,
    projectId: String(payload.projectId ?? projectId),
    released: payload.released === true,
    archived: payload.archived === true,
    releaseDate: payload.releaseDate,
    startDate: payload.startDate,
  };
}

/** Calendar-day comparison on ISO timestamps or dates (EXP-04). */
export function sameDay(left?: string, right?: string): boolean {
  if (!left || !right) return false;
  return left.slice(0, 10) === right.slice(0, 10);
}

/** Splits a list into fixed-size groups (JQL `key in (...)` batching). */
export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    groups.push(items.slice(index, index + size));
  }
  return groups;
}

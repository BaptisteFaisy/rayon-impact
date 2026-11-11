/**
 * In-memory `JiraClient` for tests: no network, no Forge runtime, no timers.
 *
 * The collector (src/collect/jira.ts) and every test of another module talk to
 * the `JiraClient` interface, so this fake is the single stand-in for Jira.
 * It serves paginated JQL results, routes the `development[...]` fallback
 * queries, records every call, and can make one endpoint fail on demand —
 * which is how the "source unavailable, never empty" rule gets tested.
 *
 * This module imports types only: loading it never pulls `@forge/api`.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type {
  JiraClient,
  JiraIssuePayload,
  JiraProjectPayload,
  JiraRemoteLinkPayload,
  JiraSearchPage,
  JiraVersionPayload,
} from './jira-client';

/** Default project key; mirrors tests/fixtures/builders.PROJECT_KEY. */
const DEFAULT_PROJECT_KEY = 'PAY';

export interface FakeJiraFailures {
  search?: string;
  version?: string;
  versions?: string;
  issue?: string;
  remoteLinks?: string;
  project?: string;
  comment?: string;
}

/**
 * What the fake serves. Pages are given as successive `searchJql` responses:
 * page N+1 is served when the collector comes back with the token of page N.
 */
export interface FakeJiraPages {
  project?: JiraProjectPayload;
  version?: JiraVersionPayload;
  /** Pages of the release JQL (`fixVersion = "<version.name>"`). */
  issuePages?: JiraIssuePayload[][];
  /** Pages per sibling version name, for the EXP-04 collection. */
  siblingPages?: Record<string, JiraIssuePayload[][]>;
  /** Pages per `development[...]` clause, for the dev-info fallback (R5 §3). */
  devPages?: Record<string, JiraIssuePayload[][]>;
  /** Issues reachable by id or key: changelog backfill, cross-project links. */
  issues?: Record<string, JiraIssuePayload>;
  versions?: JiraVersionPayload[];
  remoteLinks?: Record<string, JiraRemoteLinkPayload[]>;
  failures?: FakeJiraFailures;
}

export interface FakeJiraCall {
  method: keyof JiraClient;
  args: unknown[];
}

export interface FakeJiraClient extends JiraClient {
  calls: FakeJiraCall[];
}

/* ------------------------------------------------------------- builders */

export function issuePayload(
  key: string,
  partial: Partial<JiraIssuePayload> = {},
): JiraIssuePayload {
  const id = partial.id ?? `id-${key.toLowerCase()}`;
  return {
    ...partial,
    id,
    key,
    fields: {
      summary: `${key} summary`,
      status: { name: 'Done', statusCategory: { key: 'done' } },
      issuetype: { name: 'Story' },
      project: { key: DEFAULT_PROJECT_KEY },
      components: [],
      fixVersions: [],
      issuelinks: [],
      ...partial.fields,
    },
  };
}

export function issuePayloads(keys: string[]): JiraIssuePayload[] {
  return keys.map((key) => issuePayload(key));
}

/** Splits issues into fixed-size pages, like a real paginated search would. */
export function chunkPages(
  issues: JiraIssuePayload[],
  size: number,
): JiraIssuePayload[][] {
  const pages: JiraIssuePayload[][] = [];
  for (let index = 0; index < issues.length; index += size) {
    pages.push(issues.slice(index, index + size));
  }
  return pages;
}

export function changelogAddedTo(
  versionName: string,
  createdAt: string,
): JiraIssuePayload['changelog'] {
  return {
    histories: [
      {
        created: createdAt,
        items: [
          { field: 'Fix Version', fieldId: 'fixVersions', toString: versionName },
        ],
      },
    ],
  };
}

export function changelogReopened(
  createdAt: string,
): JiraIssuePayload['changelog'] {
  return {
    histories: [
      {
        created: createdAt,
        items: [
          { field: 'status', fieldId: 'status', toString: 'Reopened' },
        ],
      },
    ],
  };
}

/** Concatenates changelog parts so one ticket can carry several facts. */
export function mergeChangelogs(
  ...parts: (JiraIssuePayload['changelog'] | undefined)[]
): JiraIssuePayload['changelog'] {
  return { histories: parts.flatMap((part) => part?.histories ?? []) };
}

/* -------------------------------------------------------------- routing */

function throwIf(message: string | undefined, label: string): void {
  if (message !== undefined) throw new Error(`${label}: ${message}`);
}

const DEV_CLAUSE = /development\[/;
const FIX_VERSION_NAME = /fixVersion\s*=\s*"([^"]+)"/;

function pagesFor(pages: FakeJiraPages, jql: string): JiraIssuePayload[][] {
  if (DEV_CLAUSE.test(jql)) {
    const clause = Object.keys(pages.devPages ?? {}).find((key) => jql.includes(key));
    return clause ? pages.devPages?.[clause] ?? [] : [];
  }
  const name = FIX_VERSION_NAME.exec(jql)?.[1];
  if (name === undefined || pages.version === undefined || name === pages.version.name) {
    return pages.issuePages ?? [];
  }
  return pages.siblingPages?.[name] ?? [];
}

function pageAt(served: JiraIssuePayload[][], token: string | undefined): JiraSearchPage {
  const index = token ? Number(token) : 0;
  const issues = served[index] ?? [];
  const next = index + 1 < served.length ? String(index + 1) : undefined;
  return { issues, ...(next ? { nextPageToken: next } : {}) };
}

function lookupIssue(pages: FakeJiraPages, issueId: string): JiraIssuePayload | undefined {
  const direct = pages.issues?.[issueId];
  if (direct) return direct;
  const known = Object.values(pages.issues ?? {}).find(
    (candidate) => candidate.id === issueId || candidate.key === issueId,
  );
  if (known) return known;
  const served = [
    ...(pages.issuePages ?? []).flat(),
    ...Object.values(pages.siblingPages ?? {}).flat(2),
  ];
  return served.find(
    (candidate) => candidate.id === issueId || candidate.key === issueId,
  );
}

/* --------------------------------------------------------------- client */

type Recorder = (method: keyof JiraClient, args: unknown[]) => void;

/** The search endpoint: paginated, routed by JQL, failable. */
function searchMethods(
  pages: FakeJiraPages,
  failures: FakeJiraFailures,
  record: Recorder,
): Pick<JiraClient, 'searchJql'> {
  return {
    async searchJql(jql, fields, max, pageToken, expand) {
      record('searchJql', [jql, fields, max, pageToken, expand]);
      throwIf(failures.search, 'searchJql');
      return pageAt(pagesFor(pages, jql), pageToken);
    },
  };
}

/** The single-resource reads the collector needs. */
function readMethods(
  pages: FakeJiraPages,
  failures: FakeJiraFailures,
  record: Recorder,
): Pick<JiraClient, 'getVersion' | 'getIssue' | 'listProjectVersions' | 'getRemoteLinks' | 'getProject'> {
  return {
    async getVersion(versionId) {
      record('getVersion', [versionId]);
      throwIf(failures.version, 'getVersion');
      if (!pages.version) throw new Error(`getVersion: no version ${versionId}`);
      return pages.version;
    },
    async getIssue(issueId, expand) {
      record('getIssue', [issueId, expand]);
      throwIf(failures.issue, 'getIssue');
      const found = lookupIssue(pages, issueId);
      if (!found) throw new Error(`getIssue: unknown issue ${issueId}`);
      return found;
    },
    async listProjectVersions(projectId) {
      record('listProjectVersions', [projectId]);
      throwIf(failures.versions, 'listProjectVersions');
      return pages.versions ?? [];
    },
    async getRemoteLinks(issueId) {
      record('getRemoteLinks', [issueId]);
      throwIf(failures.remoteLinks, 'getRemoteLinks');
      return pages.remoteLinks?.[issueId] ?? [];
    },
    async getProject(projectId) {
      record('getProject', [projectId]);
      throwIf(failures.project, 'getProject');
      return pages.project ?? { id: projectId, key: DEFAULT_PROJECT_KEY, name: 'Paiements' };
    },
  };
}

/**
 * The in-memory client. Each call is recorded, so a test can assert *what* was
 * asked (the JQL, the expand, the page token) and not only what came back.
 */
export function createFakeJiraClient(pages: FakeJiraPages = {}): FakeJiraClient {
  const calls: FakeJiraCall[] = [];
  const failures = pages.failures ?? {};
  const record: Recorder = (method, args) => {
    calls.push({ method, args });
  };
  return {
    calls,
    ...searchMethods(pages, failures, record),
    ...readMethods(pages, failures, record),
    async addComment(issueId, text) {
      record('addComment', [issueId, text]);
      throwIf(failures.comment, 'addComment');
    },
  };
}

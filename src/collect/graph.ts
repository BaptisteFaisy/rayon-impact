/**
 * Teamwork Graph collection (SPEC §12 "Lecture du Teamwork Graph", §14, R5 §2.5-2.6).
 *
 * Three rules drive this file:
 *   - the graph is only readable **as a user** (`api.asUser(accountId)
 *     .requestTeamworkGraph`); there is no `asApp()` variant (R5 §2.1), so a
 *     collection without a viewer returns null;
 *   - raw Cypher is closed to new apps: every read goes through a registered
 *     query (`customQuery(queryKey, queryParams)`, R5 §2.6);
 *   - a missing `read:graph:…` scope raises **no error**, the objects are just
 *     omitted (R5 §1.6, SPEC §14). Silence is reported through `missingScopes`,
 *     and a family whose scope is missing is dropped entirely so no signal
 *     reads an empty traversal as "nothing to see" (SPEC §15).
 *
 * This module is one of the two allowed to import `@forge/api` (CONVENTIONS §2).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import api from '@forge/api';
import type { DevSummary, GraphFacts, Team } from '../types';
import {
  CollectRequestError,
  asArray,
  asNumber,
  asRecord,
  prop,
  uniqueSorted,
  type ForgeResponseLike,
} from './paging';

/** Scopes this collector needs, one per object type (R5 §1.6). */
export const GRAPH_SCOPES = {
  issue: 'read:graph:issue:jira',
  commit: 'read:graph:commit:external',
  pullRequest: 'read:graph:pull-request:external',
  build: 'read:graph:build:external',
  component: 'read:graph:component:compass',
  team: 'read:graph:team:atlassian',
  service: 'read:graph:service:external',
} as const;

/**
 * Keys of the Cypher queries registered once by the app setup script
 * (`POST /gateway/api/twg/cypher-queries`, R5 §2.6). The values below are
 * readable placeholders: the real ones are the UUIDs returned at registration.
 */
export interface GraphQueryKeys {
  dev: string;
  components: string;
  teams: string;
  services: string;
}

export const DEFAULT_GRAPH_QUERY_KEYS: GraphQueryKeys = {
  dev: 'rayon-impact-dev-by-issue',
  components: 'rayon-impact-components-by-issue',
  teams: 'rayon-impact-teams-by-component',
  services: 'rayon-impact-services-by-incident',
};

/** R5 §2.6: `customQuery` returns at most 25 rows per call. */
export const GRAPH_ROW_LIMIT = 25;

export interface GraphQueryError {
  message?: string;
}

export interface GraphQueryResult {
  data?: Record<string, unknown>;
  errors?: GraphQueryError[];
}

/** One graph read, already authenticated as the viewer. */
export interface GraphRunner {
  run(
    queryKey: string,
    params: Record<string, unknown>,
    limit: number,
  ): Promise<GraphQueryResult>;
}

/** An object to look up in the graph: the map key plus its ARI. */
export interface GraphTarget {
  /** Key of the resulting map — `issue.subjectId`, or the incident key. */
  id: string;
  ari: string;
}

export interface TeamworkGraphInput {
  /** The human whose rights are used: the graph never runs as the app. */
  viewerAccountId: string;
  /** Injected clock, so `fetchedAt` is deterministic in tests. */
  now: string;
  issues: GraphTarget[];
  /** Incidents, keyed by **key** (`servicesByIncidentId` is read that way). */
  incidents: GraphTarget[];
  limit?: number;
}

export type GraphRow = Record<string, unknown>;

/** Upper-cased property, for enum-like fields (`MERGED`, `FAILED`, …). */
function upperOf(node: unknown, key: string): string {
  return prop(node, key).toUpperCase();
}

/** A Cypher list column wraps its nodes; a scalar column passes through. */
function columnValue(value: unknown): unknown {
  const record = asRecord(value);
  if (!Array.isArray(record.nodes)) return value;
  return record.nodes.map((node) => asRecord(node).data ?? node);
}

/** Flattens the `customQuery { edges { node { columns } } }` envelope into rows. */
export function rowsFromGraph(result: GraphQueryResult): GraphRow[] {
  const custom = asRecord(asRecord(result.data).customQuery);
  return asArray(custom.edges).map((edge) => {
    const columns = asRecord(asRecord(edge).node).columns;
    const row: GraphRow = {};
    for (const column of asArray(columns)) {
      const { key, value } = asRecord(column);
      if (typeof key === 'string') row[key] = columnValue(value);
    }
    return row;
  });
}

/** Scopes named by a GraphQL error, when the API chooses to say one is missing. */
export function scopesInErrors(errors: GraphQueryError[]): string[] {
  const found = new Set<string>();
  for (const error of errors) {
    for (const match of (error.message ?? '').matchAll(/read:graph:[a-z-]+:[a-z-]+/g)) {
      found.add(match[0]);
    }
  }
  return [...found];
}

/**
 * Rewrites the row key column to the app id we asked for. The registered query
 * returns whatever id it matched (`item.id`), which may be the ARI: facts are
 * keyed by `issue.subjectId`, so the mapping happens here, once.
 */
export function rekeyRows(
  rows: GraphRow[],
  column: string,
  targets: GraphTarget[],
): GraphRow[] {
  const byRef = new Map<string, string>();
  for (const target of targets) {
    byRef.set(target.ari, target.id);
    byRef.set(target.id, target.id);
  }
  return rows.map((row) => {
    const raw = row[column];
    const id = typeof raw === 'string' ? byRef.get(raw) : undefined;
    return id ? { ...row, [column]: id } : row;
  });
}

/* ------------------------------------------------------------ families */

interface FamilySpec {
  queryKey: string;
  params: Record<string, unknown>;
  /** Scope expected for each returned column. */
  columnScopes: Record<string, string>;
}

interface FamilyOutcome {
  rows: GraphRow[];
  /** False = the read itself failed (unregistered query, network, …). */
  ok: boolean;
  missingScopes: string[];
}

/**
 * Runs one family and decides whether its data can be trusted. A column that
 * is **absent** from every row means the object type was omitted by a missing
 * scope (R5 §1.6); a column present but empty is a legitimate "nothing here".
 * Either way the family is dropped, so no detector reads silence as good news.
 */
async function runFamily(
  runner: GraphRunner,
  spec: FamilySpec,
  limit: number,
): Promise<FamilyOutcome> {
  let result: GraphQueryResult;
  try {
    result = await runner.run(spec.queryKey, spec.params, limit);
  } catch {
    return { rows: [], ok: false, missingScopes: [] };
  }

  const errors = result.errors ?? [];
  const fromErrors = scopesInErrors(errors);
  const rows = rowsFromGraph(result);

  if (rows.length === 0) {
    const failed = errors.length > 0;
    return { rows: [], ok: !failed, missingScopes: failed ? fromErrors : [] };
  }
  if (fromErrors.length > 0) {
    return { rows: [], ok: true, missingScopes: fromErrors };
  }

  const absent = Object.entries(spec.columnScopes)
    .filter(([column]) => rows.every((row) => !(column in row)))
    .map(([, scope]) => scope);
  if (absent.length > 0) return { rows: [], ok: true, missingScopes: absent };

  return { rows, ok: true, missingScopes: [] };
}

/* -------------------------------------------------------------- mapping */

/** Development summary of one ticket, from its commits/PRs/builds nodes. */
export function devSummaryFromRow(row: GraphRow): DevSummary {
  const commits = asArray(row.commits);
  const pulls = asArray(row.pullRequests);
  const builds = asArray(row.builds);
  const merged = pulls.filter((pull) => upperOf(pull, 'state') === 'MERGED');
  const failing = builds.filter((build) => /FAIL/i.test(upperOf(build, 'state')));

  return {
    known: commits.length + pulls.length + builds.length > 0,
    commits: commits.length,
    openPullRequests: pulls.filter((pull) => upperOf(pull, 'state') === 'OPEN').length,
    mergedPullRequests: merged.length,
    mergedWithoutApproval: merged.filter((pull) => asNumber(asRecord(pull).approvedCount) === 0).length,
    failingBuilds: failing.length,
    lastBuildState: builds.length === 0 ? 'unknown' : failing.length > 0 ? 'failing' : 'success',
  };
}

function idsOf(nodes: unknown): string[] {
  return asArray(nodes)
    .map((node) => prop(node, 'id'))
    .filter((id) => id.length > 0);
}

/** `devByIssueId`, keyed by `issue.subjectId`. */
export function devMap(rows: GraphRow[]): Record<string, DevSummary> {
  const out: Record<string, DevSummary> = {};
  for (const row of rows) {
    const id = prop(row, 'issueId');
    if (id) out[id] = devSummaryFromRow(row);
  }
  return out;
}

/** `componentsByIssueId`, keyed by `issue.subjectId`. */
export function componentsMap(rows: GraphRow[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const row of rows) {
    const id = prop(row, 'issueId');
    if (id) out[id] = idsOf(row.components);
  }
  return out;
}

/** Teams read by component, attached to the tickets touching that component. */
export function teamsMap(
  componentRows: GraphRow[],
  teamRows: GraphRow[],
): Record<string, Team[]> {
  const teamsByComponent = new Map<string, Team[]>();
  for (const row of teamRows) {
    const componentId = prop(row, 'componentId');
    if (!componentId) continue;
    const teams = asArray(row.teams)
      .map((node) => ({
        id: prop(node, 'id'),
        name: prop(node, 'name'),
        componentIds: [componentId],
      }))
      .filter((team) => team.id.length > 0);
    teamsByComponent.set(componentId, teams);
  }

  const out: Record<string, Team[]> = {};
  for (const row of componentRows) {
    const issueId = prop(row, 'issueId');
    if (!issueId) continue;
    const owned = idsOf(row.components).flatMap(
      (componentId) => teamsByComponent.get(componentId) ?? [],
    );
    const byId = new Map(owned.map((team) => [team.id, team]));
    if (byId.size > 0) out[issueId] = [...byId.values()];
  }
  return out;
}

/** `servicesByIncidentId`, keyed by incident key (see src/signals/future.ts). */
export function servicesMap(rows: GraphRow[]): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const row of rows) {
    const key = prop(row, 'incidentKey');
    if (!key) continue;
    const [serviceId = ''] = idsOf(row.services);
    out[key] = serviceId.length > 0 ? serviceId : null;
  }
  return out;
}

/* ------------------------------------------------------------ collector */

/**
 * Reads the graph facts of one release as `viewerAccountId`.
 * Returns null — never an empty object — when the graph cannot be read at all:
 * "no data" must not look like "nothing wrong" (SPEC §15).
 */
export class TeamworkGraphCollector {
  constructor(
    private readonly runner: GraphRunner,
    private readonly queryKeys: GraphQueryKeys = DEFAULT_GRAPH_QUERY_KEYS,
  ) {}

  async collect(input: TeamworkGraphInput): Promise<GraphFacts | null> {
    if (!input.viewerAccountId || input.issues.length === 0) return null;

    const limit = Math.min(Math.max(input.limit ?? GRAPH_ROW_LIMIT, 1), GRAPH_ROW_LIMIT);
    const [dev, components, teams, services] = await Promise.all([
      runFamily(this.runner, this.devSpec(input), limit),
      runFamily(this.runner, this.componentsSpec(input), limit),
      runFamily(this.runner, this.teamsSpec(input), limit),
      runFamily(this.runner, this.servicesSpec(input), limit),
    ]);

    const outcomes = [dev, components, teams, services];
    if (!outcomes.some((outcome) => outcome.ok)) return null;

    return {
      fetchedAt: input.now,
      fetchedByAccountId: input.viewerAccountId,
      devByIssueId: devMap(rekeyRows(dev.rows, 'issueId', input.issues)),
      // No documented relation ticket -> service in the graph (R5 §6): the
      // service of a ticket comes from its Compass components, resolved by
      // src/collect/services.ts. Left empty on purpose, never guessed.
      servicesByIssueId: {},
      teamsByIssueId: teamsMap(
        rekeyRows(components.rows, 'issueId', input.issues),
        teams.rows,
      ),
      componentsByIssueId: componentsMap(rekeyRows(components.rows, 'issueId', input.issues)),
      servicesByIncidentId: servicesMap(
        rekeyRows(services.rows, 'incidentKey', input.incidents),
      ),
      missingScopes: uniqueSorted(outcomes.flatMap((outcome) => outcome.missingScopes)),
    };
  }

  private issueIds(input: TeamworkGraphInput): string[] {
    return input.issues.map((issue) => issue.ari);
  }

  private devSpec(input: TeamworkGraphInput): FamilySpec {
    return {
      queryKey: this.queryKeys.dev,
      params: { ids: this.issueIds(input) },
      columnScopes: {
        commits: GRAPH_SCOPES.commit,
        pullRequests: GRAPH_SCOPES.pullRequest,
        builds: GRAPH_SCOPES.build,
      },
    };
  }

  private componentsSpec(input: TeamworkGraphInput): FamilySpec {
    return {
      queryKey: this.queryKeys.components,
      params: { ids: this.issueIds(input) },
      columnScopes: { components: GRAPH_SCOPES.component },
    };
  }

  private teamsSpec(input: TeamworkGraphInput): FamilySpec {
    return {
      queryKey: this.queryKeys.teams,
      params: { ids: this.issueIds(input) },
      columnScopes: { teams: GRAPH_SCOPES.team },
    };
  }

  private servicesSpec(input: TeamworkGraphInput): FamilySpec {
    return {
      queryKey: this.queryKeys.services,
      params: { ids: input.incidents.map((incident) => incident.ari) },
      columnScopes: { services: GRAPH_SCOPES.service },
    };
  }
}

/* ------------------------------------------------------- Forge adapter */

/**
 * One persisted-Cypher read (R5 §2.6). The fragments cover the object types
 * the facts need; properties are read defensively on our side, so a renamed
 * field degrades to "absent" instead of throwing.
 */
export function graphCustomQuery(limit: number): string {
  const first = Math.min(Math.max(Math.trunc(limit), 1), GRAPH_ROW_LIMIT);
  return `query RayonImpact($queryKey: String!, $queryParams: CypherRequestParams) {
  customQuery(queryKey: $queryKey, queryParams: $queryParams, first: ${first}) {
    edges { node { columns { key value { __typename
      ... on CypherQueryResultListNode { nodes { id data { __typename
        ... on ExternalCommit { id }
        ... on ExternalPullRequest { id state approvedCount }
        ... on ExternalBuild { id state }
        ... on CompassComponent { id name }
        ... on AtlassianTeam { id name }
        ... on ExternalService { id name }
      } } } } } } }
  }
}`;
}

/** The slice of `@forge/api` we need — `asApp()` has no graph method (R5 §2.1). */
interface TeamworkGraphApi {
  requestTeamworkGraph(
    query: string,
    variables?: unknown,
    operationName?: string,
    extensions?: unknown,
    headers?: Record<string, string>,
  ): Promise<ForgeResponseLike>;
}

/**
 * Real runner: every call runs as the viewer (`api.asUser(accountId)`).
 * `requestTeamworkGraph` is missing from the typings of the installed
 * `@forge/api` (5.x, while R5 §2.1 documents 8.5.0), hence the local interface.
 */
export function createTeamworkGraphRunner(viewerAccountId: string): GraphRunner {
  const asUser = api.asUser(viewerAccountId) as unknown as TeamworkGraphApi;
  return {
    async run(queryKey, params, limit): Promise<GraphQueryResult> {
      const response = await asUser.requestTeamworkGraph(graphCustomQuery(limit), {
        queryKey,
        queryParams: params,
      });
      if (!response.ok) throw new CollectRequestError(response.status, 'requestTeamworkGraph');
      return (await response.json()) as GraphQueryResult;
    },
  };
}

/** Convenience factory: the collector wired to the real Forge runner. */
export function createTeamworkGraphCollector(
  viewerAccountId: string,
  queryKeys: GraphQueryKeys = DEFAULT_GRAPH_QUERY_KEYS,
): TeamworkGraphCollector {
  return new TeamworkGraphCollector(createTeamworkGraphRunner(viewerAccountId), queryKeys);
}

/** Test double: answers by query key; an unknown key answers with empty data. */
export function createFakeGraphRunner(
  answers: Record<string, GraphQueryResult | Error>,
): GraphRunner {
  return {
    async run(queryKey): Promise<GraphQueryResult> {
      const answer = answers[queryKey];
      if (answer === undefined) return { data: {} };
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

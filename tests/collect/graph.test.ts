import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GRAPH_QUERY_KEYS,
  GRAPH_ROW_LIMIT,
  GRAPH_SCOPES,
  TeamworkGraphCollector,
  createFakeGraphRunner,
  graphCustomQuery,
  rowsFromGraph,
  scopesInErrors,
} from '../../src/collect/graph.js';
import type { GraphQueryResult, GraphRunner, TeamworkGraphInput } from '../../src/collect/graph.js';

/**
 * Teamwork Graph collection (SPEC §12, §14, R5 §1.6/§2.6).
 *
 * No network: `createFakeGraphRunner` answers by registered-query key, so the
 * envelope parsing, the ARI → subjectId rekeying and — the point of the whole
 * file — the silent-scope behaviour are asserted directly.
 */

const NOW = '2026-11-11T06:00:00.000Z';
const VIEWER = 'user-release-lead';
const ISSUE_ID = 'id-pay-127';
const ISSUE_ARI = 'ari:cloud:jira:cloud-id:issue/10001';
const INCIDENT_KEY = 'INC-52';
const INCIDENT_ARI = 'ari:cloud:jira:cloud-id:issue/20001';

type Node = Record<string, unknown>;

/** A Cypher list column, wrapped exactly like `CypherQueryResultListNode`. */
function list(nodes: Node[]): Node {
  return {
    __typename: 'CypherQueryResultListNode',
    nodes: nodes.map((data) => ({ id: String(data.id ?? 'node'), data })),
  };
}

/** One `customQuery` edge: the row is a list of {key, value} columns. */
function row(columns: Record<string, unknown>): Node {
  return {
    node: { columns: Object.entries(columns).map(([key, value]) => ({ key, value })) },
  };
}

function answer(rows: Node[]): GraphQueryResult {
  return { data: { customQuery: { edges: rows } } };
}

function input(partial: Partial<TeamworkGraphInput> = {}): TeamworkGraphInput {
  return {
    viewerAccountId: VIEWER,
    now: NOW,
    issues: [{ id: ISSUE_ID, ari: ISSUE_ARI }],
    incidents: [{ id: INCIDENT_KEY, ari: INCIDENT_ARI }],
    ...partial,
  };
}

const NOMINAL: Record<string, GraphQueryResult> = {
  [DEFAULT_GRAPH_QUERY_KEYS.dev]: answer([
    row({
      issueId: ISSUE_ARI,
      commits: list([{ id: 'c1' }, { id: 'c2' }]),
      pullRequests: list([
        { id: 'pr-open', state: 'OPEN' },
        { id: 'pr-merged', state: 'MERGED', approvedCount: 0 },
      ]),
      builds: list([{ id: 'b1', state: 'SUCCESS' }]),
    }),
  ]),
  [DEFAULT_GRAPH_QUERY_KEYS.components]: answer([
    row({ issueId: ISSUE_ARI, components: list([{ id: 'cmp-checkout', name: 'checkout-api' }]) }),
  ]),
  [DEFAULT_GRAPH_QUERY_KEYS.teams]: answer([
    row({ componentId: 'cmp-checkout', teams: list([{ id: 'team-pay', name: 'Paiements' }]) }),
  ]),
  [DEFAULT_GRAPH_QUERY_KEYS.services]: answer([
    row({ incidentKey: INCIDENT_KEY, services: list([{ id: 'svc-checkout-api' }]) }),
  ]),
};

describe('TeamworkGraphCollector — nominal read', () => {
  it('builds the four maps, keyed by subjectId and incident key', async () => {
    const collector = new TeamworkGraphCollector(createFakeGraphRunner(NOMINAL));

    const facts = await collector.collect(input());

    expect(facts).not.toBeNull();
    expect(facts?.fetchedAt).toBe(NOW);
    expect(facts?.fetchedByAccountId).toBe(VIEWER);
    expect(facts?.missingScopes).toEqual([]);
    // The graph answers with ARIs; the facts are keyed by issue.subjectId.
    expect(facts?.devByIssueId[ISSUE_ID]).toEqual({
      known: true,
      commits: 2,
      openPullRequests: 1,
      mergedPullRequests: 1,
      mergedWithoutApproval: 1,
      failingBuilds: 0,
      lastBuildState: 'success',
    });
    expect(facts?.componentsByIssueId[ISSUE_ID]).toEqual(['cmp-checkout']);
    expect(facts?.teamsByIssueId[ISSUE_ID]).toEqual([
      { id: 'team-pay', name: 'Paiements', componentIds: ['cmp-checkout'] },
    ]);
    expect(facts?.servicesByIncidentId[INCIDENT_KEY]).toBe('svc-checkout-api');
  });

  it('reads the graph as the viewer, never as the app', async () => {
    const seen: string[] = [];
    const runner: GraphRunner = {
      async run(queryKey) {
        seen.push(queryKey);
        return NOMINAL[queryKey] ?? { data: {} };
      },
    };

    await new TeamworkGraphCollector(runner).collect(input());

    expect(seen).toHaveLength(4);
    expect(new Set(seen)).toEqual(
      new Set([
        DEFAULT_GRAPH_QUERY_KEYS.dev,
        DEFAULT_GRAPH_QUERY_KEYS.components,
        DEFAULT_GRAPH_QUERY_KEYS.teams,
        DEFAULT_GRAPH_QUERY_KEYS.services,
      ]),
    );
  });

  it('sends the ARIs of the tickets, and the incident ARIs to the service query', async () => {
    const seen: Record<string, unknown>[] = [];
    const runner: GraphRunner = {
      async run(queryKey, params) {
        seen.push({ queryKey, params });
        return NOMINAL[queryKey] ?? { data: {} };
      },
    };

    await new TeamworkGraphCollector(runner).collect(input());

    const dev = seen.find((call) => call.queryKey === DEFAULT_GRAPH_QUERY_KEYS.dev);
    const services = seen.find((call) => call.queryKey === DEFAULT_GRAPH_QUERY_KEYS.services);
    expect(dev?.params).toEqual({ ids: [ISSUE_ARI] });
    expect(services?.params).toEqual({ ids: [INCIDENT_ARI] });
  });

  it('caps the page size at the 25 rows of customQuery (R5 §2.6)', async () => {
    const limits: number[] = [];
    const runner: GraphRunner = {
      async run(_queryKey, _params, limit) {
        limits.push(limit);
        return { data: {} };
      },
    };

    await new TeamworkGraphCollector(runner).collect(input({ limit: 500 }));

    expect(limits.every((limit) => limit === GRAPH_ROW_LIMIT)).toBe(true);
    expect(graphCustomQuery(500)).toContain('first: 25');
  });
});

describe('TeamworkGraphCollector — missing scope', () => {
  it('reports the scope and drops the family instead of reading it as clean', async () => {
    const partialAnswers: Record<string, GraphQueryResult> = {
      ...NOMINAL,
      [DEFAULT_GRAPH_QUERY_KEYS.dev]: answer([
        // No `pullRequests` column at all: the object type was omitted (R5 §1.6).
        row({ issueId: ISSUE_ARI, commits: list([{ id: 'c1' }]), builds: list([]) }),
      ]),
    };
    const collector = new TeamworkGraphCollector(createFakeGraphRunner(partialAnswers));

    const facts = await collector.collect(input());

    expect(facts?.missingScopes).toEqual([GRAPH_SCOPES.pullRequest]);
    expect(facts?.devByIssueId).toEqual({});
    // The other families are unaffected.
    expect(facts?.componentsByIssueId[ISSUE_ID]).toEqual(['cmp-checkout']);
  });

  it('reports a failing build so QUAL-01 can fire, and a green one does not', async () => {
    const answers: Record<string, GraphQueryResult> = {
      ...NOMINAL,
      [DEFAULT_GRAPH_QUERY_KEYS.dev]: answer([
        row({
          issueId: ISSUE_ARI,
          commits: list([{ id: 'c1' }]),
          pullRequests: list([{ id: 'pr-1', state: 'MERGED', approvedCount: 2 }]),
          builds: list([{ id: 'b1', state: 'FAILED' }]),
        }),
      ]),
    };
    const facts = await new TeamworkGraphCollector(createFakeGraphRunner(answers)).collect(input());

    expect(facts?.devByIssueId[ISSUE_ID]).toMatchObject({
      known: true,
      failingBuilds: 1,
      lastBuildState: 'failing',
      mergedWithoutApproval: 0,
    });
  });

  it('drops only the family whose scope is missing, keeping the others readable', async () => {
    const answers: Record<string, GraphQueryResult> = {
      ...NOMINAL,
      [DEFAULT_GRAPH_QUERY_KEYS.teams]: answer([row({ componentId: 'cmp-checkout' })]),
    };
    const facts = await new TeamworkGraphCollector(createFakeGraphRunner(answers)).collect(input());

    expect(facts?.missingScopes).toEqual([GRAPH_SCOPES.team]);
    expect(facts?.teamsByIssueId).toEqual({});
    expect(facts?.componentsByIssueId[ISSUE_ID]).toEqual(['cmp-checkout']);
    expect(facts?.servicesByIncidentId[INCIDENT_KEY]).toBe('svc-checkout-api');
  });

  it('reads the scope out of a GraphQL error when the API reports one', async () => {
    const answers: Record<string, GraphQueryResult> = {
      ...NOMINAL,
      [DEFAULT_GRAPH_QUERY_KEYS.dev]: {
        errors: [{ message: 'Scope read:graph:commit:external is not granted for this app' }],
      },
    };
    const collector = new TeamworkGraphCollector(createFakeGraphRunner(answers));

    const facts = await collector.collect(input());

    expect(facts?.missingScopes).toEqual([GRAPH_SCOPES.commit]);
    expect(facts?.devByIssueId).toEqual({});
  });

  it('keeps a legitimately empty list as data, not as a missing scope', async () => {
    const answers: Record<string, GraphQueryResult> = {
      ...NOMINAL,
      [DEFAULT_GRAPH_QUERY_KEYS.dev]: answer([
        row({ issueId: ISSUE_ARI, commits: list([]), pullRequests: list([]), builds: list([]) }),
      ]),
    };
    const collector = new TeamworkGraphCollector(createFakeGraphRunner(answers));

    const facts = await collector.collect(input());

    expect(facts?.missingScopes).toEqual([]);
    expect(facts?.devByIssueId[ISSUE_ID]?.known).toBe(false);
  });
});

describe('TeamworkGraphCollector — unavailable graph', () => {
  it('returns null when every family fails', async () => {
    const answers: Record<string, GraphQueryResult | Error> = {
      [DEFAULT_GRAPH_QUERY_KEYS.dev]: new Error('QUERY_NOT_FOUND'),
      [DEFAULT_GRAPH_QUERY_KEYS.components]: new Error('QUERY_NOT_FOUND'),
      [DEFAULT_GRAPH_QUERY_KEYS.teams]: new Error('QUERY_NOT_FOUND'),
      [DEFAULT_GRAPH_QUERY_KEYS.services]: new Error('QUERY_NOT_FOUND'),
    };
    const collector = new TeamworkGraphCollector(createFakeGraphRunner(answers));

    expect(await collector.collect(input())).toBeNull();
  });

  it('returns null without a viewer: the graph has no app identity (R5 §2.1)', async () => {
    const collector = new TeamworkGraphCollector(createFakeGraphRunner(NOMINAL));

    expect(await collector.collect(input({ viewerAccountId: '' }))).toBeNull();
  });

  it('returns null when there is no ticket to query', async () => {
    const collector = new TeamworkGraphCollector(createFakeGraphRunner(NOMINAL));

    expect(await collector.collect(input({ issues: [] }))).toBeNull();
  });
});

describe('graph envelope helpers', () => {
  it('flattens the customQuery envelope into rows', () => {
    const rows = rowsFromGraph(answer([row({ issueId: 'x', commits: list([{ id: 'c1' }]) })]));

    expect(rows).toEqual([{ issueId: 'x', commits: [{ id: 'c1' }] }]);
  });

  it('ignores an answer without data', () => {
    expect(rowsFromGraph({ errors: [{ message: 'boom' }] })).toEqual([]);
  });

  it('extracts the scopes named by the errors', () => {
    expect(
      scopesInErrors([
        { message: 'missing read:graph:build:external' },
        { message: 'missing read:graph:team:atlassian' },
        {},
      ]),
    ).toEqual([GRAPH_SCOPES.build, GRAPH_SCOPES.team]);
  });
});

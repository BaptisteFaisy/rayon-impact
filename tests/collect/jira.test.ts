import { beforeAll, describe, expect, it } from 'vitest';
import type { JiraIssueLinkPayload, JiraIssuePayload } from '../../src/collect/jira-client';
import { JiraReleaseCollector, MAX_ISSUES } from '../../src/collect/jira';
import {
  changelogAddedTo,
  changelogReopened,
  chunkPages,
  createFakeJiraClient,
  issuePayload,
  issuePayloads,
  mergeChangelogs,
  type FakeJiraClient,
  type FakeJiraPages,
} from '../../src/collect/jira-fake';
import type {
  CollectedRelease,
  GraphFacts,
  IssueStatusCategory,
  JiraIssue,
  SourceName,
  SourceStatus,
} from '../../src/types';
import { PROJECT_KEY, graphFacts, healthyDev } from '../fixtures/builders';
import {
  MOB_77,
  paiementsIssues,
  paiementsPages,
  paiementsPolicy,
  paiementsRelease,
} from '../fixtures/paiements';

/**
 * JiraReleaseCollector against the in-memory fake: no network, no Forge.
 * The dataset is the canonical Paiements release, converted to the payloads
 * Jira would return, so the fixture stays the single source of truth.
 */

const release = paiementsRelease();
const CYCLE_START = release.cycleStartedAt ?? '';
const VERSION_NAME = release.version.name;
const VIEWER = 'user-release-lead';

function categoryKey(category?: IssueStatusCategory): string {
  if (category === 'done') return 'done';
  if (category === 'in-progress') return 'indeterminate';
  return 'new';
}

/** Domain link → Jira payload link, keeping which side this issue is on. */
function linkPayload(link: JiraIssue['links'][number]): JiraIssueLinkPayload {
  const target = {
    id: link.targetId,
    key: link.targetKey,
    fields: {
      project: { key: link.targetProjectKey },
      status: {
        name: link.targetStatusCategory ?? '',
        statusCategory: { key: categoryKey(link.targetStatusCategory) },
      },
      fixVersions: (link.targetFixVersions ?? []).map((name) => ({ name })),
    },
  };
  return {
    id: link.id,
    type: { name: link.type },
    ...(link.inward ? { inwardIssue: target } : { outwardIssue: target }),
  };
}

function changelogFor(source: JiraIssue): JiraIssuePayload['changelog'] {
  return mergeChangelogs(
    changelogAddedTo(VERSION_NAME, source.addedToVersionAt ?? CYCLE_START),
    source.reopenedDuringCycle ? changelogReopened(CYCLE_START) : undefined,
  );
}

/** Canonical fixture issue → what Jira would answer for it. */
function toPayload(source: JiraIssue, extraLinks: JiraIssueLinkPayload[] = []): JiraIssuePayload {
  return issuePayload(source.key, {
    id: source.subjectId,
    changelog: changelogFor(source),
    fields: {
      summary: source.summary,
      status: {
        name: source.statusName,
        statusCategory: { key: categoryKey(source.statusCategory) },
      },
      issuetype: { name: source.issueType },
      project: { key: source.projectKey },
      components: source.components.map((name) => ({ name })),
      fixVersions: source.fixVersions.map((name) => ({ name })),
      issuelinks: [...source.links.map(linkPayload), ...extraLinks],
    },
  });
}

function sourceOf(collected: CollectedRelease, name: SourceName): SourceStatus {
  const found = collected.sources.find((status) => status.source === name);
  if (!found) throw new Error(`missing source ${name}`);
  return found;
}

function issueOf(collected: CollectedRelease, key: string): JiraIssue {
  const found = collected.issues.find((issue) => issue.key === key);
  if (!found) throw new Error(`missing issue ${key}`);
  return found;
}

/** The release ticket MOB-77 depends on, seen from the release side. */
const mobileTarget = release.issues.find((issue) => issue.key === MOB_77.links[0]?.targetKey);
const mobileLink = MOB_77.links[0];

function releaseIssues(): JiraIssuePayload[] {
  const inbound: JiraIssueLinkPayload[] = [
    {
      id: mobileLink.id,
      type: { name: mobileLink.type },
      inwardIssue: {
        id: MOB_77.subjectId,
        key: MOB_77.key,
        fields: { project: { key: MOB_77.projectKey } },
      },
    },
  ];
  return release.issues.map((issue) =>
    toPayload(issue, issue.key === mobileTarget?.key ? inbound : []),
  );
}

/** JQL fallback answers, derived from the fixture's dev summaries (R5 §3). */
function devPages(): FakeJiraPages['devPages'] {
  const keysWhere = (predicate: (issue: JiraIssue) => boolean): JiraIssuePayload[][] => [
    issuePayloads(release.issues.filter(predicate).map((issue) => issue.key)),
  ];
  return {
    'development[commits].all': keysWhere(
      (issue) => issue.dev.known && (issue.dev.commits > 0 || issue.dev.mergedPullRequests > 0),
    ),
    'development[pullrequests].open': keysWhere(
      (issue) => issue.dev.known && issue.dev.openPullRequests > 0,
    ),
    'development[pullrequests].all': keysWhere(
      (issue) =>
        issue.dev.known &&
        (issue.dev.openPullRequests > 0 || issue.dev.mergedPullRequests > 0),
    ),
    'development[builds].failing > 0': keysWhere(
      (issue) => issue.dev.known && issue.dev.failingBuilds > 0,
    ),
  };
}

function paiementsFake(overrides: Partial<FakeJiraPages> = {}): FakeJiraClient {
  const [guide] = paiementsPages();
  return createFakeJiraClient({
    project: { id: release.project.id, key: PROJECT_KEY, name: release.project.name },
    version: {
      id: release.version.id,
      name: VERSION_NAME,
      projectId: release.project.id,
      releaseDate: release.version.releaseDate,
      startDate: release.version.startDate,
    },
    versions: [
      { id: release.version.id, name: VERSION_NAME, releaseDate: release.version.releaseDate },
      { id: 'ver-25', name: '2.5', releaseDate: release.version.releaseDate },
      { id: 'ver-26', name: '2.6', releaseDate: '2026-12-01' },
      { id: 'ver-23', name: '2.3', releaseDate: release.version.releaseDate, released: true },
    ],
    issuePages: [releaseIssues()],
    siblingPages: {
      '2.5': [
        [
          issuePayload('PAY-150', {
            fields: {
              components: [{ name: 'checkout-api' }],
              fixVersions: [{ name: '2.5' }],
            },
          }),
        ],
      ],
    },
    devPages: devPages(),
    issues: { [MOB_77.subjectId]: toPayload(MOB_77) },
    remoteLinks: {
      [mobileTarget?.subjectId ?? '']: [
        { id: 'rl-guide', object: { url: guide.url, title: guide.title } },
      ],
    },
    ...overrides,
  });
}

function collectorFor(fake: FakeJiraClient, graph: GraphFacts | null = null) {
  return new JiraReleaseCollector({
    client: fake,
    policy: paiementsPolicy(),
    graph,
    clock: { now: () => '2026-11-11T07:00:00.000Z' },
    pageResolver: async () => paiementsPages(),
  });
}

const nominalFake = paiementsFake();
let collected: CollectedRelease;

beforeAll(async () => {
  collected = await collectorFor(nominalFake).collect(
    release.project.id,
    release.version.id,
    VIEWER,
  );
});

describe('JiraReleaseCollector — project, version and tickets', () => {
  it('reads the project, the version and every ticket of the version', () => {
    expect(collected.project).toMatchObject({ key: PROJECT_KEY, versionsEnabled: true });
    expect(collected.version.name).toBe(VERSION_NAME);
    expect(collected.issues.map((issue) => issue.key)).toEqual(
      release.issues.map((issue) => issue.key),
    );
    expect(collected.collectedAt).toBe('2026-11-11T07:00:00.000Z');
  });

  it('searches on fixVersion and asks for the changelog', () => {
    const search = nominalFake.calls.find((call) => call.method === 'searchJql');
    expect(search?.args[0]).toBe(`project = "${PROJECT_KEY}" AND fixVersion = "${VERSION_NAME}"`);
    expect(search?.args[4]).toEqual(['changelog']);
  });

  it('keeps status, components and service resolution of the fixture', () => {
    for (const expected of release.issues) {
      const actual = issueOf(collected, expected.key);
      expect(actual.statusCategory).toBe(expected.statusCategory);
      expect(actual.components).toEqual(expected.components);
      expect(actual.serviceId).toBe(expected.serviceId);
    }
  });

  it('maps issue links, keeping the side and the blocker status', () => {
    expect(issueOf(collected, 'PAY-130').links).toEqual([
      expect.objectContaining({
        targetKey: 'PAY-118',
        inward: true,
        targetStatusCategory: 'in-progress',
      }),
    ]);
  });

});

describe('JiraReleaseCollector — history, links and pages', () => {
  it('reads addedToVersionAt and reopenedDuringCycle from the changelog', () => {
    expect(issueOf(collected, 'PAY-133').addedToVersionAt).toBe('2026-11-11T00:00:00.000Z');
    expect(issueOf(collected, 'PAY-134').reopenedDuringCycle).toBe(true);
    expect(issueOf(collected, 'PAY-127').reopenedDuringCycle).toBe(false);
  });

  it('collects Confluence remote links and the pages behind them', () => {
    const [guide] = paiementsPages();
    expect(issueOf(collected, 'PAY-127').remoteLinks).toEqual([
      { id: 'rl-guide', url: guide.url, title: guide.title, kind: 'confluence' },
    ]);
    expect(collected.pages.map((entry) => entry.subjectId)).toEqual(
      paiementsPages().map((entry) => entry.subjectId),
    );
  });

  it('finds the cross-project ticket that depends on the release (DEP-02)', () => {
    expect(collected.linkedOutsideIssues.map((issue) => issue.key)).toEqual([MOB_77.key]);
    expect(collected.linkedOutsideIssues[0].links[0]).toMatchObject({
      targetKey: mobileTarget?.key,
      targetProjectKey: PROJECT_KEY,
    });
  });

});

describe('JiraReleaseCollector — siblings, development and sources', () => {
  it('keeps only the unreleased siblings shipping the same day (EXP-04)', () => {
    expect(collected.siblingVersions.map((version) => version.name)).toEqual(['2.5']);
    expect(collected.issuesOfSiblingVersions['ver-25'][0].serviceId).toBe('svc-checkout-api');
  });

  it('fills the development summary from the JQL fallback', () => {
    expect(issueOf(collected, 'PAY-131').dev).toMatchObject({ openPullRequests: 1, known: true });
    expect(issueOf(collected, 'PAY-129').dev).toMatchObject({
      failingBuilds: 1,
      lastBuildState: 'failing',
    });
    expect(issueOf(collected, 'PAY-132').dev).toMatchObject({ commits: 0, known: true });
    expect(issueOf(collected, 'PAY-127').dev.commits).toBe(1);
  });

  it('reports every source honestly', () => {
    expect(sourceOf(collected, 'jira').state).toBe('ok');
    expect(sourceOf(collected, 'development').state).toBe('partial');
    expect(sourceOf(collected, 'teamwork-graph').state).toBe('unavailable');
    expect(sourceOf(collected, 'jsm').state).toBe('unavailable');
    expect(sourceOf(collected, 'confluence').state).toBe('ok');
    expect(sourceOf(collected, 'service-map').state).toBe('ok');
  });
});

describe('JiraReleaseCollector — graph and failing sources', () => {
  it('prefers the cached Teamwork Graph development block (SPEC §12)', async () => {
    const fake = paiementsFake();
    const graph = graphFacts({ devByIssueId: { 'id-pay-127': healthyDev({ commits: 3 }) } });
    const collected = await collectorFor(fake, graph).collect(
      release.project.id,
      release.version.id,
      VIEWER,
    );

    expect(issueOf(collected, 'PAY-127').dev.commits).toBe(3);
    expect(sourceOf(collected, 'development').state).toBe('ok');
    expect(sourceOf(collected, 'teamwork-graph').state).toBe('ok');
    expect(fake.calls.some((call) => String(call.args[0]).includes('development['))).toBe(false);
  });

  it('marks Jira unavailable — never empty — when the search fails', async () => {
    const fake = paiementsFake({ failures: { search: 'boom' } });
    const collected = await collectorFor(fake).collect(
      release.project.id,
      release.version.id,
      VIEWER,
    );

    expect(collected.issues).toEqual([]);
    expect(sourceOf(collected, 'jira')).toMatchObject({
      state: 'unavailable',
      detail: { key: 'signal.source.jira' },
    });
  });

  it('marks Jira unavailable when the version cannot be read', async () => {
    const fake = paiementsFake({ failures: { version: 'boom' } });
    const collected = await collectorFor(fake).collect(
      release.project.id,
      release.version.id,
      VIEWER,
    );

    expect(collected.version.id).toBe(release.version.id);
    expect(collected.issues).toEqual([]);
    expect(sourceOf(collected, 'jira').state).toBe('unavailable');
  });

  it('keeps the tickets but reports Confluence unavailable when remote links fail', async () => {
    const fake = paiementsFake({ failures: { remoteLinks: 'boom' } });
    const collected = await collectorFor(fake).collect(
      release.project.id,
      release.version.id,
      VIEWER,
    );

    expect(collected.issues).toHaveLength(release.issues.length);
    expect(issueOf(collected, 'PAY-127').remoteLinks).toEqual([]);
    expect(sourceOf(collected, 'confluence')).toMatchObject({
      state: 'unavailable',
      detail: { key: 'signal.source.confluence' },
    });
  });

  it('reports an incident source failure instead of zero incidents', async () => {
    const collector = new JiraReleaseCollector({
      client: paiementsFake(),
      policy: paiementsPolicy(),
      incidentSource: async () => {
        throw new Error('jsm down');
      },
    });
    const collected = await collector.collect(
      release.project.id,
      release.version.id,
      VIEWER,
    );

    expect(collected.incidents).toEqual([]);
    expect(sourceOf(collected, 'jsm').state).toBe('unavailable');
  });
});

describe('JiraReleaseCollector — limits and missing history', () => {
  it(`stops at ${MAX_ISSUES} tickets and says so`, async () => {
    const keys = Array.from({ length: MAX_ISSUES + 100 }, (_, index) => `BULK-${index + 1}`);
    const payloads = issuePayloads(keys).map((payload) => ({
      ...payload,
      changelog: changelogAddedTo('9.9', CYCLE_START),
    }));
    const fake = createFakeJiraClient({
      version: { id: 'ver-99', name: '9.9' },
      issuePages: chunkPages(payloads, 100),
    });
    const collected = await collectorFor(fake).collect('proj-pay', 'ver-99', VIEWER);

    expect(collected.issues).toHaveLength(MAX_ISSUES);
    expect(sourceOf(collected, 'jira')).toMatchObject({
      state: 'partial',
      detail: { key: 'signal.source.jira' },
    });
  });

  it('treats a ticket without changelog as unknown history, not as clean', async () => {
    const payload = issuePayload('PAY-900', { fields: { fixVersions: [{ name: '3.0' }] } });
    const fake = createFakeJiraClient({
      version: { id: 'ver-30', name: '3.0' },
      issuePages: [[payload]],
    });
    const collected = await collectorFor(fake).collect('proj-pay', 'ver-30', VIEWER);
    const ticket = collected.issues[0];

    expect(ticket.key).toBe('PAY-900');
    expect(ticket.addedToVersionAt).toBeUndefined();
    expect(ticket.reopenedDuringCycle).toBe(false);
    expect(sourceOf(collected, 'jira')).toMatchObject({
      state: 'partial',
      detail: { key: 'signal.source.jiraHistory' },
    });
  });

  it('flags a project without the Versions feature (SPEC §16)', async () => {
    const fake = createFakeJiraClient({
      project: { id: 'proj-pay', key: PROJECT_KEY, name: 'Paiements', simplified: true },
      version: { id: 'ver-24', name: VERSION_NAME },
    });
    const collected = await collectorFor(fake).collect('proj-pay', 'ver-24', VIEWER);

    expect(collected.project.versionsEnabled).toBe(false);
    expect(collected.siblingVersions).toEqual([]);
  });
});

/** Guard: the canonical issue list must stay the dataset under test. */
it('collects the canonical Paiements issue count', () => {
  expect(paiementsIssues()).toHaveLength(release.issues.length);
});

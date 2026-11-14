import type {
  CollectedRelease,
  GraphFacts,
  JiraIssue,
  Policy,
  SeverityCounts,
  Team,
  Verdict,
  Confidence,
} from '../../src/types';
import {
  collected,
  healthyDev,
  incident,
  issue,
  page,
  policy,
  project,
  team,
  version,
  graphFacts,
} from './builders';
import {
  paiementsPolicy,
  paiementsRelease,
  LINKED_OUTSIDE_ISSUES,
  paiementsIssues,
} from './paiements';

/**
 * Demo scenarios: ready-made releases the demo can play without a prepared
 * Jira site. Pure domain — no Forge import, no I/O, no real clock: every
 * scenario carries its own `now`, so the engine stays deterministic (SPEC §8).
 *
 * Labels are plain bilingual data, not app UI strings: they never go through
 * `t()` and no i18n key is invented (CONVENTIONS §3 — `src/i18n/index.ts` is a
 * shared file this module must not extend).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** What a demo audience reads before the verdict is shown. */
export interface DemoLabel {
  en: string;
  fr: string;
}

/** One playable release: its data, its clock, and the measured expectation. */
export interface DemoScenario {
  id: string;
  label: DemoLabel;
  /** One-line story, shown under the label in the demo. */
  story: DemoLabel;
  release: CollectedRelease;
  policy: Policy;
  /** ISO 8601 evaluation instant — the only clock the detectors may see. */
  now: string;
  expected: {
    verdict: Verdict;
    confidence: Confidence;
    counts: SeverityCounts;
  };
}

/* ----------------------------------------------------------- paiements 2.4 */

/** The canonical dataset: 14 tickets, 9 signals, no-go (DEMO-DATA §2). */
function paiements24(): DemoScenario {
  return {
    id: 'paiements-24',
    label: { en: 'Paiements 2.4 — canonical', fr: 'Paiements 2.4 — canonique' },
    story: {
      en: '14 tickets, one still in flight, an open incident on checkout-api.',
      fr: '14 tickets, un encore en cours, un incident ouvert sur checkout-api.',
    },
    release: paiementsRelease(),
    policy: paiementsPolicy(),
    now: '2026-11-11T06:00:00.000Z',
    expected: {
      verdict: 'no-go',
      confidence: 'high',
      counts: { blocking: 5, major: 2, minor: 3, info: 0 },
    },
  };
}

/** The 12 tickets of the video variant: PAY-129 and PAY-130 out of 2.4. */
function videoVariantIssues() {
  return paiementsIssues().filter(
    (ticket) => ticket.key !== 'PAY-129' && ticket.key !== 'PAY-130',
  );
}

/** SPEC §18 as filmed: the cross-project ticket and the stale guide are seen. */
function paiements24Video(): DemoScenario {
  const base = paiements24();
  const release = collected({
    ...base.release,
    issues: videoVariantIssues(),
    linkedOutsideIssues: LINKED_OUTSIDE_ISSUES,
  });
  return {
    ...base,
    id: 'paiements-24-video',
    label: { en: 'Paiements 2.4 — video variant', fr: 'Paiements 2.4 — variante vidéo' },
    story: {
      en: 'The §18 story: remove PAY-131, waive the incident, verdict moves.',
      fr: 'Le scénario §18 : retirer PAY-131, déroger à l’incident, l’avis bouge.',
    },
    release,
    expected: {
      verdict: 'no-go',
      confidence: 'high',
      counts: { blocking: 3, major: 3, minor: 3, info: 0 },
    },
  };
}

/* --------------------------------------------------------------- mobile 3.1 */

const MOBILE_SERVICES = [
  {
    serviceId: 'svc-mobile-app',
    serviceName: 'mobile-app',
    jiraComponent: 'mobile-app',
    compassComponentId: 'cmp-mobile',
  },
];

/** Healthy tickets only: every detector stays silent on this release. */
function mobileCleanIssues(): JiraIssue[] {
  const summaries = [
    'Surface new payment methods',
    'Cache PSP contract flags',
    'Ship refund idempotency keys',
    'Roll out the new checkout sheet',
  ];
  return summaries.map((summary, index) =>
    issue(`MOB-${40 + index}`, {
      summary,
      components: ['mobile-app'],
      serviceId: 'svc-mobile-app',
      serviceName: 'mobile-app',
      fixVersions: ['3.1'],
      dev: healthyDev(),
    }),
  );
}

/** The Mobile team owns `cmp-mobile`, the component every 3.1 ticket carries. */
function mobileTeam(): Team {
  return team('team-mobile', { name: 'Mobile', componentIds: ['cmp-mobile'] });
}

/**
 * The graph block of a clean release: the owning team is attached to real
 * tickets, otherwise DEP-03 (minor) fires on `mobile-app` for want of a linked
 * ticket from the team that owns the service.
 */
function mobile31Graph(now: string, issues: JiraIssue[], owners: Team): GraphFacts {
  return graphFacts({
    fetchedAt: now,
    teamsByIssueId: Object.fromEntries(issues.map((ticket) => [ticket.subjectId, [owners]])),
    componentsByIssueId: Object.fromEntries(issues.map((ticket) => [ticket.subjectId, ['cmp-mobile']])),
  });
}

/** A release with nothing to complain about: go, high confidence (DEMO §1). */
function mobile31Release(): CollectedRelease {
  const now = '2026-11-18T06:00:00.000Z';
  const issues = mobileCleanIssues();
  return collected({
    project: project({ id: 'proj-mob', key: 'MOB', name: 'Mobile' }),
    version: version({
      id: 'ver-mob-31',
      name: '3.1',
      projectId: 'proj-mob',
      releaseDate: '2026-11-19',
      startDate: '2026-11-05',
    }),
    issues,
    incidents: [
      incident('INC-61', {
        summary: 'Push delivery lag',
        state: 'resolved',
        serviceId: 'svc-push',
        serviceName: 'push-gateway',
        createdAt: '2026-11-01T08:00:00.000Z',
        resolvedAt: '2026-11-02T11:00:00.000Z',
      }),
    ],
    pages: [
      page('9101', {
        title: 'Mobile release runbook',
        lastModified: '2026-11-16T10:00:00.000Z',
      }),
    ],
    teams: [mobileTeam()],
    graph: mobile31Graph(now, issues, mobileTeam()),
    cycleStartedAt: '2026-11-05T00:00:00.000Z',
    collectedAt: now,
  });
}

/** Scenario: the release every demo audience wishes it had — nothing to say. */
function mobile31(): DemoScenario {
  return {
    id: 'mobile-31',
    label: { en: 'Mobile 3.1 — clean release', fr: 'Mobile 3.1 — release saine' },
    story: {
      en: 'Four tickets, all done, code visible, service known: nothing holds it.',
      fr: 'Quatre tickets, tous finis, code visible, service connu : rien ne retient.',
    },
    release: mobile31Release(),
    policy: policy({
      projectId: 'proj-mob',
      serviceMap: MOBILE_SERVICES,
      jsmProjectKeys: ['INC'],
    }),
    now: '2026-11-18T06:00:00.000Z',
    expected: {
      verdict: 'go',
      confidence: 'high',
      counts: { blocking: 0, major: 0, minor: 0, info: 0 },
    },
  };
}

/* ---------------------------------------------------------- plateforme 9.0 */

const PLATFORM_SERVICES = [
  {
    serviceId: 'svc-ledger',
    serviceName: 'ledger-core',
    jiraComponent: 'ledger',
    compassComponentId: 'cmp-ledger',
    jsmService: 'ledger-core',
  },
  {
    serviceId: 'svc-webhook',
    serviceName: 'webhook-fanout',
    jiraComponent: 'webhooks',
  },
];

/** Tickets holding the release back: in flight, open PR, red build, blocked. */
function platformBlockingIssues() {
  return [
    issue('PLT-901', {
      summary: 'Rewrite ledger entry journaling',
      statusName: 'In Progress',
      statusCategory: 'in-progress',
      components: ['ledger'],
      serviceId: 'svc-ledger',
      serviceName: 'ledger-core',
      fixVersions: ['9.0'],
      dev: healthyDev({ openPullRequests: 2, mergedPullRequests: 0 }),
    }),
    issue('PLT-904', {
      summary: 'Move settlement batching behind a flag',
      components: ['ledger'],
      serviceId: 'svc-ledger',
      serviceName: 'ledger-core',
      fixVersions: ['9.0'],
      dev: healthyDev({ failingBuilds: 3, lastBuildState: 'failing' }),
      links: [
        {
          id: 'link-plt904-plt880',
          type: 'Blocks',
          inward: true,
          targetKey: 'PLT-880',
          targetId: 'id-plt-880',
          targetProjectKey: 'PLT',
          targetStatusCategory: 'to-do',
          targetFixVersions: [],
        },
      ],
    }),
  ];
}

/** Quality and timing noise around the blockers (majors and minors). */
function platformQualityIssues() {
  return [
    issue('PLT-907', {
      summary: 'Retry webhook fanout on timeout',
      components: ['webhooks'],
      serviceId: 'svc-webhook',
      serviceName: 'webhook-fanout',
      fixVersions: ['9.0'],
      dev: healthyDev({ mergedWithoutApproval: 2 }),
    }),
    issue('PLT-911', {
      summary: 'Backfill ledger balances',
      components: ['ledger'],
      serviceId: 'svc-ledger',
      serviceName: 'ledger-core',
      fixVersions: ['9.0'],
      addedToVersionAt: '2026-11-19T09:00:00.000Z',
    }),
    issue('PLT-913', {
      summary: 'Duplicate settlement event on retry',
      issueType: 'Bug',
      reopenedDuringCycle: true,
      components: ['ledger'],
      serviceId: 'svc-ledger',
      serviceName: 'ledger-core',
      fixVersions: ['9.0'],
    }),
    issue('PLT-915', {
      summary: 'Document the ledger migration',
      components: ['ledger'],
      serviceId: 'svc-ledger',
      serviceName: 'ledger-core',
      fixVersions: ['9.0'],
      remoteLinks: [
        {
          id: 'link-plt915-page9201',
          url: 'https://pay.atlassian.net/wiki/pages/9201',
          title: 'Ledger migration guide',
          kind: 'confluence',
        },
      ],
    }),
  ];
}

/** The release calendar: a freeze window covering the planned date (EXP-03). */
function platformFreeze() {
  return [
    {
      id: 'fz-blackfriday',
      name: 'Black Friday freeze',
      from: '2026-11-20',
      to: '2026-11-27',
      scope: 'services' as const,
      serviceIds: ['svc-ledger'],
    },
  ];
}

/** A sibling shipping the same day on the same service (EXP-04). */
function platformSiblings() {
  return [
    version({
      id: 'ver-plt-89',
      name: '8.9',
      projectId: 'proj-plt',
      releaseDate: '2026-11-24',
    }),
  ];
}

function platformSiblingIssues() {
  return {
    'ver-plt-89': [
      issue('PLT-899', {
        summary: 'Ledger metric export',
        components: ['ledger'],
        serviceId: 'svc-ledger',
        serviceName: 'ledger-core',
        fixVersions: ['8.9'],
      }),
    ],
  };
}

/** The two tickets outside 9.0 that hold it back and depend on it (DEP-01/02). */
function platformOutsideIssues(): JiraIssue[] {
  return [
    issue('PLT-880', {
      summary: 'Refactor settlement batching',
      statusName: 'To Do',
      statusCategory: 'to-do',
      fixVersions: [],
      components: ['ledger'],
      serviceId: 'svc-ledger',
      serviceName: 'ledger-core',
    }),
    issue('MOB-91', {
      summary: 'Mobile: adapt to the new ledger API',
      projectKey: 'MOB',
      components: ['mobile-app'],
      serviceId: 'svc-mobile-app',
      serviceName: 'mobile-app',
      fixVersions: [],
      links: [
        {
          id: 'link-mob91-plt901',
          type: 'Depends on',
          inward: false,
          targetKey: 'PLT-901',
          targetId: 'id-plt-901',
          targetProjectKey: 'PLT',
          targetStatusCategory: 'in-progress',
          targetFixVersions: ['9.0'],
        },
      ],
    }),
  ];
}

/** One open incident on the ledger, one resolved three days ago (EXP-01/02). */
function platformIncidents(): ReturnType<typeof incident>[] {
  return [
    incident('INC-70', {
      summary: 'Ledger write latency spike',
      serviceId: 'svc-ledger',
      serviceName: 'ledger-core',
      createdAt: '2026-11-20T22:00:00.000Z',
    }),
    incident('INC-66', {
      summary: 'Webhook backlog',
      state: 'resolved',
      majorIncident: true,
      serviceId: 'svc-webhook',
      serviceName: 'webhook-fanout',
      createdAt: '2026-11-15T08:00:00.000Z',
      resolvedAt: '2026-11-19T10:00:00.000Z',
    }),
  ];
}

/** The worst case a demo can show: five blocking families at once. */
function plateforme90Release(): CollectedRelease {
  const now = '2026-11-21T06:00:00.000Z';
  return collected({
    project: project({ id: 'proj-plt', key: 'PLT', name: 'Plateforme' }),
    version: version({
      id: 'ver-plt-90',
      name: '9.0',
      projectId: 'proj-plt',
      releaseDate: '2026-11-24',
      startDate: '2026-10-26',
    }),
    issues: [...platformBlockingIssues(), ...platformQualityIssues()],
    linkedOutsideIssues: platformOutsideIssues(),
    incidents: platformIncidents(),
    pages: [
      page('9201', {
        title: 'Ledger migration guide',
        lastModified: '2026-09-30T10:00:00.000Z',
      }),
    ],
    teams: [team('team-platform', { name: 'Plateforme', componentIds: ['cmp-ledger'] })],
    graph: graphFacts({ fetchedAt: now }),
    siblingVersions: platformSiblings(),
    issuesOfSiblingVersions: platformSiblingIssues(),
    freezeWindows: platformFreeze(),
    cycleStartedAt: '2026-10-26T00:00:00.000Z',
    collectedAt: now,
  });
}

/** Scenario: the worst case worth showing — every blocking family at once. */
function plateforme90(): DemoScenario {
  return {
    id: 'plateforme-90',
    label: {
      en: 'Plateforme 9.0 — everything wrong',
      fr: 'Plateforme 9.0 — tout ce qui va mal',
    },
    story: {
      en: 'Five blocking families, a freeze window and a sibling the same day.',
      fr: 'Cinq familles bloquantes, un gel du calendrier et une voisine le même jour.',
    },
    release: plateforme90Release(),
    policy: policy({
      projectId: 'proj-plt',
      serviceMap: PLATFORM_SERVICES,
      jsmProjectKeys: ['INC'],
    }),
    now: '2026-11-21T06:00:00.000Z',
    expected: {
      verdict: 'no-go',
      confidence: 'high',
      counts: { blocking: 6, major: 4, minor: 4, info: 0 },
    },
  };
}

/** Every playable scenario, in demo order (the canonical one first). */
export const DEMO_SCENARIOS: DemoScenario[] = [
  paiements24(),
  paiements24Video(),
  mobile31(),
  plateforme90(),
];

/** One scenario by id; throws when the id is unknown (demo wiring bug). */
export function demoScenario(id: string): DemoScenario {
  const found = DEMO_SCENARIOS.find((scenario) => scenario.id === id);
  if (!found) throw new Error(`Unknown demo scenario "${id}"`);
  return found;
}

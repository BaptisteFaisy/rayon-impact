import type { CollectedRelease, Policy } from '../../src/types';
import {
  collected,
  graphFacts,
  healthyDev,
  incident,
  issue,
  page,
  policy,
  team,
  unknownDev,
  version,
} from './builders';

/**
 * Canonical demo dataset: project "Paiements", release 2.4, 14 tickets.
 *
 * Built to reproduce the SPEC §18 video scenario and to cover the §17
 * acceptance tests with one shared dataset:
 *
 *   PAY-127  done, touches checkout-api            -> clean, but linked from MOB-77
 *   PAY-128  done, touches checkout-api            -> clean
 *   PAY-129  done, latest build failing            -> QUAL-01 (blocking)
 *   PAY-130  done, blocked by PAY-118 (open)       -> DEP-01  (blocking)
 *   PAY-131  in progress, open PR                  -> COMP-01 + COMP-03 (blocking)
 *   PAY-132  done, no commit and no PR             -> COMP-02 (major)
 *   PAY-133  done, added to the version 6h ago     -> COMP-04 (minor)
 *   PAY-134  done, bug reopened during the cycle   -> QUAL-03 (minor)
 *   PAY-135  done, PR merged without approval      -> QUAL-02 (major)
 *   PAY-136..140 done with code and service        -> clean
 *
 *   INC-52   open incident on checkout-api          -> EXP-01 (blocking)
 *   INC-48   resolved 3 days ago on checkout-api    -> EXP-02 (major)
 *   MOB-77   other project, depends on PAY-127      -> DEP-02 (major)
 *   page 9001 "Integration guide", untouched        -> DOC-01 (minor)
 *
 * Expected verdict on the raw dataset: no-go (5 blocking signals), confidence
 * medium (13 of 14 tickets have visible code = 0.93, services 13/14 = 0.93 —
 * see tests/engine for the exact expectations).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

export const BLOCKER_OUTSIDE_VERSION = issue('PAY-118', {
  statusName: 'In Progress',
  statusCategory: 'in-progress',
  fixVersions: [],
  summary: 'Refactor settlement batching',
});

export const MOB_77 = issue('MOB-77', {
  projectKey: 'MOB',
  summary: 'Mobile: surface new payment methods',
  components: ['mobile-app'],
  serviceId: 'svc-mobile-app',
  serviceName: 'mobile-app',
  links: [
    {
      id: 'link-mob77-pay127',
      type: 'Depends on',
      inward: false,
      targetKey: 'PAY-127',
      targetId: 'id-pay-127',
      targetProjectKey: 'PAY',
      targetStatusCategory: 'done',
      targetFixVersions: ['2.4'],
    },
  ],
});

/** The five tickets touching checkout-api or holding the release back. */
export function serviceAndBlockingIssues() {
  return [
    issue('PAY-127', {
      summary: 'Add SEPA instant credit',
      // The integration guide is linked to the ticket and was not updated since
      // the cycle started: DOC-01 (SPEC §18).
      remoteLinks: [
        {
          id: 'link-pay127-page9001',
          url: 'https://pay.atlassian.net/wiki/pages/9001',
          title: 'Integration guide',
          kind: 'confluence',
        },
      ],
    }),
    issue('PAY-128', { summary: 'Harden 3DS retry path' }),
    issue('PAY-129', {
      summary: 'Upgrade ledger client',
      dev: healthyDev({ failingBuilds: 1, lastBuildState: 'failing' }),
    }),
    issue('PAY-130', {
      summary: 'Switch to batched settlements',
      links: [
        {
          id: 'link-pay130-pay118',
          type: 'Blocks',
          inward: true,
          targetKey: 'PAY-118',
          targetId: 'id-pay-118',
          targetProjectKey: 'PAY',
          targetStatusCategory: 'in-progress',
          targetFixVersions: [],
        },
      ],
    }),
    issue('PAY-131', {
      summary: 'Rework refund ledger entries',
      statusName: 'In Progress',
      statusCategory: 'in-progress',
      dev: healthyDev({ openPullRequests: 1, mergedPullRequests: 0 }),
    }),
  ];
}

/** Late addition, reopened bug, unapproved merge and ticket without code. */
export function qualityIssues() {
  return [
    issue('PAY-132', { summary: 'Document settlement SLA', dev: unknownDev() }),
    issue('PAY-133', {
      summary: 'Round-up cents on FX',
      addedToVersionAt: '2026-11-11T00:00:00.000Z',
    }),
    issue('PAY-134', {
      summary: 'Duplicate webhook on timeout',
      issueType: 'Bug',
      reopenedDuringCycle: true,
    }),
    issue('PAY-135', {
      summary: 'Bump crypto provider',
      dev: healthyDev({ mergedWithoutApproval: 1 }),
    }),
  ];
}

/** The five tickets with visible code and a known service: they raise nothing. */
export function cleanIssues() {
  return [
    issue('PAY-136', { summary: 'Trace id propagation' }),
    issue('PAY-137', { summary: 'Idempotency keys on refunds' }),
    issue('PAY-138', { summary: 'Retry budget tuning' }),
    issue('PAY-139', { summary: 'Settlement dashboard tiles' }),
    issue('PAY-140', { summary: 'PSP contract flags' }),
  ];
}

/** The nine tickets of release 2.4 that carry at least one signal (SPEC §18). */
export function issuesWithSignals() {
  return [...serviceAndBlockingIssues(), ...qualityIssues()];
}

/** The 14 tickets of release 2.4, in key order (SPEC §18). */
export function paiementsIssues() {
  return [...issuesWithSignals(), ...cleanIssues()];
}

export function paiementsIncidents() {
  return [
    incident('INC-52', { summary: 'checkout-api latency spike' }),
    incident('INC-48', {
      summary: 'Partial refund failures',
      state: 'resolved',
      createdAt: '2026-11-05T09:00:00.000Z',
      resolvedAt: '2026-11-08T09:40:00.000Z',
    }),
  ];
}

export function paiementsPages() {
  return [
    page('9001', {
      title: 'Integration guide',
      lastModified: '2026-09-14T10:00:00.000Z',
    }),
    page('9002', {
      title: 'Runbook checkout-api',
      lastModified: '2026-11-09T10:00:00.000Z',
    }),
  ];
}

export function paiementsGraph() {
  return graphFacts({
    teamsByIssueId: {
      'id-pay-127': [team('team-mobile', { name: 'Mobile', componentIds: ['cmp-mobile'] })],
    },
    componentsByIssueId: {
      'id-pay-127': ['cmp-checkout'],
      'id-pay-128': ['cmp-checkout'],
    },
  });
}

export function paiementsRelease(): CollectedRelease {
  return collected({
    version: version({ name: '2.4', releaseDate: '2026-11-12' }),
    issues: paiementsIssues(),
    incidents: paiementsIncidents(),
    pages: paiementsPages(),
    teams: [team('team-mobile', { name: 'Mobile', componentIds: ['cmp-mobile'] })],
    graph: paiementsGraph(),
    cycleStartedAt: '2026-10-29T00:00:00.000Z',
    collectedAt: '2026-11-11T06:00:00.000Z',
  });
}

export function paiementsPolicy(): Policy {
  return policy({
    serviceMap: [
      {
        serviceId: 'svc-checkout-api',
        serviceName: 'checkout-api',
        jiraComponent: 'checkout-api',
        compassComponentId: 'cmp-checkout',
        jsmService: 'checkout-api',
      },
      {
        serviceId: 'svc-mobile-app',
        serviceName: 'mobile-app',
        jiraComponent: 'mobile-app',
        compassComponentId: 'cmp-mobile',
      },
    ],
    waiverApprovers: ['user-release-lead'],
  });
}

/**
 * Cross-project context used by DEP-02: MOB-77 lives outside the release but
 * points at PAY-127. Detectors receive it through `linkedOutsideIssues`.
 */
export const LINKED_OUTSIDE_ISSUES = [MOB_77, BLOCKER_OUTSIDE_VERSION];

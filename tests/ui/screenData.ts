import { detectAllSignals } from '../../src/engine/pipeline';
import { computeCoverage } from '../../src/engine/coverage';
import { computeVerdict } from '../../src/engine/verdict';
import { buildImpactGraph } from '../../src/engine/graph';
import { diffSnapshots } from '../../src/engine/diff';
import type { SnapshotInput } from '../../src/engine/diff';
import {
  paiementsIssues,
  paiementsPolicy,
  paiementsRelease,
  LINKED_OUTSIDE_ISSUES,
} from '../fixtures/paiements';
import { snapshot as buildSnapshot, version as buildVersion } from '../fixtures/builders';
import type { SimulateWithoutOutput, RequestWaiverOutput } from '../../src/actions/types';
import type {
  Confidence,
  Decision,
  ImpactGraph,
  ImpactedTeam,
  Outcome,
  Policy,
  ReleaseDossier,
  Signal,
  Snapshot,
  SnapshotDiff,
  Verdict,
  Waiver,
} from '../../src/types';

/**
 * One dataset for every UI render test, composed from the canonical fixtures
 * (tests/fixtures/paiements.ts) run through the real engine — no literals
 * copied, exactly the shapes the resolvers of src/index.ts return.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Evaluation instant of the demo dossier (same as tests/ui/issueKeys.test.ts). */
export const DEMO_NOW = '2026-11-11T06:00:00.000Z';

/** Row shape of `screen.projectVersions` (mirrors src/index.ts). */
export interface VersionRow {
  versionId: string;
  versionName: string;
  verdict: Verdict;
  confidence: Confidence;
  computedAt: string;
  released: boolean;
}

/** Row shape of `screen.dashboardGadget` (mirrors src/index.ts). */
export interface GadgetRow {
  versionId: string;
  versionName: string;
  verdict: Verdict;
  confidence: Confidence;
  computedAt: string;
  releaseDate: string | null;
}

/** Payload shape of `screen.issueContext` (mirrors src/index.ts). */
export interface IssueContextPayload {
  issueId: string;
  versions: { versionId: string; versionName: string; dossier: ReleaseDossier | null }[];
  observationMode: boolean;
}

export interface DemoDataset {
  dossier: ReleaseDossier;
  versionRows: VersionRow[];
  graph: ImpactGraph;
  diff: SnapshotDiff;
  teams: ImpactedTeam[];
  gadgetRows: GadgetRow[];
  issueContext: IssueContextPayload;
  policy: Policy;
  simulate: SimulateWithoutOutput;
  requestWaiver: RequestWaiverOutput;
  closeWaiver: Waiver;
}

/** The demo signals: the canonical Paiements release through every detector. */
export function demoSignals(): Signal[] {
  const release = paiementsRelease();
  release.linkedOutsideIssues = LINKED_OUTSIDE_ISSUES;
  return detectAllSignals({
    release,
    policy: paiementsPolicy(),
    now: DEMO_NOW,
    waivers: [],
    previousSignals: [],
    pastOutcomes: [],
  });
}

function demoSnapshot(signals: Signal[]): Snapshot {
  const release = paiementsRelease();
  const coverage = computeCoverage(release);
  const verdict = computeVerdict(signals, coverage, release);
  return buildSnapshot({
    versionId: release.version.id,
    versionName: release.version.name,
    computedAt: DEMO_NOW,
    verdict: verdict.verdict,
    confidence: verdict.confidence,
    coverage: verdict.coverage,
    counts: verdict.counts,
    narrative: 'PAY-131 is still in progress and INC-52 is open: the release is held back.',
    previousSnapshotId: 'snap-0',
  });
}

function demoWaivers(signals: Signal[]): Waiver[] {
  const release = paiementsRelease();
  const base = {
    subjectType: 'issue' as const,
    subjectId: signals[0].subjectId,
    versionId: release.version.id,
    signalCode: signals[0].code,
    grantedBy: 'user-release-lead',
  };
  return [
    {
      ...base,
      id: 'wvr-1',
      reason: 'Business commitment for the SEPA launch.',
      grantedAt: DEMO_NOW,
      expiresAt: '2026-11-13T06:00:00.000Z',
    },
    {
      ...base,
      id: 'wvr-0',
      reason: 'Previous cycle, already handled.',
      grantedAt: '2026-10-30T09:00:00.000Z',
      expiresAt: '2026-11-01T09:00:00.000Z',
      closedAt: '2026-11-01T09:05:00.000Z',
      closedReason: 'Expired',
    },
  ];
}

function demoDecisions(): Decision[] {
  const release = paiementsRelease();
  return [
    {
      id: 'dec-1',
      versionId: release.version.id,
      snapshotId: 'snap-1',
      decidedBy: 'user-release-lead',
      decidedAt: DEMO_NOW,
      decision: 'hold',
      verdictAtDecision: 'no-go',
      note: 'Waiting for INC-52 post-mortem.',
    },
  ];
}

function demoOutcome(): Outcome {
  const release = paiementsRelease();
  return {
    versionId: release.version.id,
    checkedAt: DEMO_NOW,
    incidents: [{ key: 'INC-48', severity: 'major', resolvedAfterMinutes: 40 }],
    rollback: false,
    notes: 'One major incident in the 72 h window.',
  };
}

function demoDossier(): ReleaseDossier {
  const signals = demoSignals();
  return {
    snapshot: demoSnapshot(signals),
    signals,
    waivers: demoWaivers(signals),
    decisions: demoDecisions(),
    outcome: demoOutcome(),
  };
}

function demoVersionRows(dossier: ReleaseDossier): VersionRow[] {
  const released = buildVersion({ id: 'ver-23', name: '2.3', released: true });
  return [
    {
      versionId: dossier.snapshot.versionId,
      versionName: dossier.snapshot.versionName,
      verdict: dossier.snapshot.verdict,
      confidence: dossier.snapshot.confidence,
      computedAt: dossier.snapshot.computedAt,
      released: false,
    },
    {
      versionId: released.id,
      versionName: released.name,
      verdict: 'go',
      confidence: 'high',
      computedAt: '2026-10-28T06:00:00.000Z',
      released: released.released,
    },
  ];
}

function demoDiff(dossier: ReleaseDossier): SnapshotDiff {
  const previous: SnapshotInput = {
    snapshot: buildSnapshot({ id: 'snap-0', verdict: 'conditional-go' }),
    signals: dossier.signals.slice(0, Math.max(1, dossier.signals.length - 2)),
  };
  const current: SnapshotInput = { snapshot: dossier.snapshot, signals: dossier.signals };
  return diffSnapshots(previous, current);
}

function demoTeams(): ImpactedTeam[] {
  const service = paiementsPolicy().serviceMap[1];
  return [
    {
      teamId: 'team-mobile',
      teamName: 'Mobile',
      services: [{ serviceId: service.serviceId, serviceName: service.serviceName }],
      issues: paiementsIssues()
        .slice(0, 2)
        .map((issue) => ({ key: issue.key, summary: issue.summary, projectKey: issue.projectKey })),
      via: 'graph',
    },
  ];
}

function demoGadgetRows(dossier: ReleaseDossier): GadgetRow[] {
  const release = paiementsRelease();
  // The gadget window is relative to the real clock: keep the row inside it.
  const soon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
  return [
    {
      versionId: release.version.id,
      versionName: release.version.name,
      verdict: dossier.snapshot.verdict,
      confidence: dossier.snapshot.confidence,
      computedAt: dossier.snapshot.computedAt,
      releaseDate: soon,
    },
  ];
}

function demoIssueContext(dossier: ReleaseDossier): IssueContextPayload {
  return {
    issueId: 'id-pay-131',
    versions: [
      {
        versionId: dossier.snapshot.versionId,
        versionName: dossier.snapshot.versionName,
        dossier,
      },
    ],
    observationMode: false,
  };
}

function demoSimulate(dossier: ReleaseDossier): SimulateWithoutOutput {
  return {
    versionId: dossier.snapshot.versionId,
    versionName: dossier.snapshot.versionName,
    removedIssueKeys: ['PAY-131'],
    unknownIssueKeys: [],
    verdictBefore: dossier.snapshot.verdict,
    verdict: 'conditional-go',
    confidence: 'medium',
    counts: { ...dossier.snapshot.counts, blocking: 0 },
    droppedSignalCount: 2,
    droppedSignalIds: dossier.signals.slice(0, 2).map((signal) => signal.id),
    conditions: [],
    minimalRemoval: { issueKeys: ['PAY-131'], simulationsRun: 4, provenMinimal: true },
  };
}

/** Builds the whole demo dataset once, from the fixtures through the engine. */
export function buildDemoDataset(): DemoDataset {
  const dossier = demoDossier();
  const waivers = dossier.waivers;
  return {
    dossier,
    versionRows: demoVersionRows(dossier),
    graph: buildImpactGraph(paiementsRelease(), dossier.signals),
    diff: demoDiff(dossier),
    teams: demoTeams(),
    gadgetRows: demoGadgetRows(dossier),
    issueContext: demoIssueContext(dossier),
    policy: paiementsPolicy(),
    simulate: demoSimulate(dossier),
    requestWaiver: { granted: true, waiver: waivers[0] },
    closeWaiver: { ...waivers[0], closedAt: DEMO_NOW, closedReason: 'Signal cleared' },
  };
}

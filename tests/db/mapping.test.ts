import { describe, expect, it } from 'vitest';
import type {
  Decision,
  Outcome,
  Signal,
  Snapshot,
  Waiver,
} from '../../src/types';
import {
  DEFAULT_COUNTS,
  DEFAULT_COVERAGE,
  DEFAULT_POLICY_RULES,
  decisionToRow,
  findingKeyFor,
  outcomeToRow,
  policyToRow,
  rowToDecision,
  rowToOutcome,
  rowToPolicy,
  rowToSignal,
  rowToSnapshot,
  rowToWaiver,
  rowsToServiceMap,
  serviceMapToRows,
  signalToRow,
  snapshotToRow,
  waiverToRow,
} from '../../src/db/mapping';
import type {
  DecisionRow,
  OutcomeRow,
  ReleaseSnapshotRow,
  SignalRow,
} from '../../src/db/mapping';
import { policy, snapshot } from '../fixtures/builders';

/* ------------------------------------------------------------- fixtures */

function signal(partial: Partial<Signal> = {}): Signal {
  return {
    id: 'COMP-01:issue:PAY-131',
    code: 'COMP-01',
    severity: 'blocking',
    status: 'active',
    subjectType: 'issue',
    subjectId: 'id-pay-131',
    finding: { key: 'signal.comp01.finding', params: { key: 'PAY-131', status: 'In Progress', category: 'in-progress' } },
    evidence: [
      {
        subjectType: 'issue',
        subjectId: 'id-pay-131',
        label: { key: 'signal.comp01.finding', params: { key: 'PAY-131' } },
        url: 'https://pay.atlassian.net/browse/PAY-131',
        restricted: true,
      },
    ],
    detectedAt: '2026-11-11T06:00:00.000Z',
    firstSeenAt: '2026-11-09T08:30:00.000Z',
    waiverId: 'wai-1',
    ...partial,
  };
}

function waiver(partial: Partial<Waiver> = {}): Waiver {
  return {
    id: 'wai-1',
    versionId: 'ver-24',
    signalCode: 'DOC-01',
    subjectType: 'page',
    subjectId: 'page-9',
    grantedBy: 'user-release-lead',
    reason: 'Doc rewrites land tomorrow.',
    grantedAt: '2026-11-11T07:00:00.000Z',
    expiresAt: '2026-11-13T07:00:00.000Z',
    ...partial,
  };
}

function decision(partial: Partial<Decision> = {}): Decision {
  return {
    id: 'dec-1',
    versionId: 'ver-24',
    snapshotId: 'snap-1',
    decidedBy: 'user-release-lead',
    decidedAt: '2026-11-11T08:00:00.000Z',
    decision: 'ship',
    verdictAtDecision: 'conditional-go',
    note: 'Shipped with the doc waiver.',
    ...partial,
  };
}

function outcome(partial: Partial<Outcome> = {}): Outcome {
  return {
    versionId: 'ver-24',
    checkedAt: '2026-11-14T08:00:00.000Z',
    incidents: [
      { key: 'INC-52', severity: 'major', resolvedAfterMinutes: 40, url: 'https://pay.atlassian.net/browse/INC-52' },
      { key: 'INC-53', severity: 'minor' },
    ],
    rollback: true,
    notes: 'One incident, resolved fast.',
    ...partial,
  };
}

/** A row as Forge returns it: booleans as 0/1, dates as `YYYY-MM-DD HH:MM:SS.fff`. */
function snapshotRow(overrides: Partial<ReleaseSnapshotRow> = {}): ReleaseSnapshotRow {
  return { ...snapshotToRow(snapshot()), ...overrides };
}

/* ----------------------------------------------------------------- tests */

describe('mapping — snapshots', () => {
  it('round-trips every field of a snapshot', () => {
    const original: Snapshot = snapshot({
      verdict: 'conditional-go',
      confidence: 'medium',
      counts: { blocking: 1, major: 2, minor: 0, info: 3 },
      narrativeVerified: false,
      narrativeRejections: ['PAY-999 is not in the release'],
      graphCachedAt: null,
      previousSnapshotId: 'snap-0',
    });
    expect(rowToSnapshot(snapshotToRow(original))).toEqual(original);
  });

  it('writes booleans as 0/1 and timestamps in the documented SQL format', () => {
    const row = snapshotToRow(snapshot({ versionReleased: true, computedAt: '2026-11-11T06:00:00.000Z' }));
    expect(row.version_released).toBe(1);
    expect(row.computed_at).toBe('2026-11-11 06:00:00.000');
    expect(row.graph_cached_at).toBe('2026-11-11 06:00:00.000');
  });

  it('reads a corrupted coverage_json as "nothing measured", never as a go', () => {
    const decoded = rowToSnapshot(snapshotRow({ coverage_json: '{"issueCount": 12' }));
    expect(decoded.coverage).toEqual(DEFAULT_COVERAGE);
  });

  it('reads corrupted counts_json as zeroed counts', () => {
    expect(rowToSnapshot(snapshotRow({ counts_json: 'not json' })).counts).toEqual(DEFAULT_COUNTS);
  });

  it('falls back on unknown enum values instead of throwing', () => {
    const decoded = rowToSnapshot(
      snapshotRow({ verdict: 'maybe', confidence: 'certain', version_released: 0 }),
    );
    expect(decoded.verdict).toBe('not-applicable');
    expect(decoded.confidence).toBe('low');
    expect(decoded.versionReleased).toBe(false);
  });

  it('keeps a null graph cache and a null previous snapshot distinct from ""', () => {
    const decoded = rowToSnapshot(snapshotRow({ graph_cached_at: null, previous_snapshot_id: null }));
    expect(decoded.graphCachedAt).toBeNull();
    expect(decoded.previousSnapshotId).toBeNull();
  });
});

describe('mapping — signals', () => {
  it('round-trips a signal with its evidence, waiver and finding params', () => {
    const original = signal();
    expect(rowToSignal(signalToRow(original, 'snap-1'))).toEqual(original);
  });

  it('stores the snapshot id from the writing context', () => {
    expect(signalToRow(signal(), 'snap-9').snapshot_id).toBe('snap-9');
  });

  it('drops the optional waiver id when the column is null', () => {
    const row: SignalRow = { ...signalToRow(signal(), 'snap-1'), waiver_id: null };
    expect(rowToSignal(row).waiverId).toBeUndefined();
  });

  it('replaces a corrupted finding with the code-derived key and no params', () => {
    const row: SignalRow = { ...signalToRow(signal(), 'snap-1'), finding_json: '{"key": ' };
    const decoded = rowToSignal(row);
    expect(decoded.finding).toEqual({ key: findingKeyFor('COMP-01'), params: {} });
    expect(decoded.finding.key).toBe('signal.comp01.finding');
  });

  it('drops evidence entries that carry no label', () => {
    const row: SignalRow = {
      ...signalToRow(signal(), 'snap-1'),
      evidence_json: '[{"subjectType":"issue","subjectId":"PAY-1"}]',
    };
    expect(rowToSignal(row).evidence).toEqual([]);
  });

  it('falls back on an unknown code, severity and status', () => {
    const row: SignalRow = {
      ...signalToRow(signal(), 'snap-1'),
      code: 'NOPE-99',
      severity: 'critical',
      status: 'forgotten',
    };
    const decoded = rowToSignal(row);
    expect(decoded.code).toBe('COMP-01');
    expect(decoded.severity).toBe('info');
    expect(decoded.status).toBe('active');
  });
});

describe('mapping — waivers, decisions, outcomes', () => {
  it('round-trips a waiver, including its closing', () => {
    const original = waiver({ closedAt: '2026-11-12T09:00:00.000Z', closedReason: 'Doc updated' });
    expect(rowToWaiver(waiverToRow(original))).toEqual(original);
  });

  it('round-trips a waiver without a closing', () => {
    const original = waiver();
    const decoded = rowToWaiver(waiverToRow(original));
    expect(decoded).toEqual(original);
    expect(decoded.closedAt).toBeUndefined();
  });

  it('round-trips a decision with its note', () => {
    const original = decision();
    expect(rowToDecision(decisionToRow(original))).toEqual(original);
  });

  it('omits the note when the column is empty', () => {
    const row: DecisionRow = { ...decisionToRow(decision()), note: null };
    expect(rowToDecision(row).note).toBeUndefined();
  });

  it('round-trips an outcome with its incidents', () => {
    const original = outcome();
    expect(rowToOutcome(outcomeToRow(original))).toEqual(original);
  });

  it('reads corrupted incidents as an empty list, never as "no incident happened"', () => {
    const row: OutcomeRow = { ...outcomeToRow(outcome()), incidents_json: '[{', rollback: 0 };
    const decoded = rowToOutcome(row);
    expect(decoded.incidents).toEqual([]);
    expect(decoded.rollback).toBe(false);
  });
});

describe('mapping — policy and service map', () => {
  it('round-trips policy rules and normalises the service map into rows', () => {
    const original = policy({
      severityOverrides: { 'COMP-01': 'major' },
      disabledSignals: ['HIST-01'],
      observationMode: true,
      defaultWaiverHours: 72,
    });
    const rows = serviceMapToRows(original.projectId, original.serviceMap);
    expect(rows).toEqual([
      {
        project_id: 'proj-pay',
        service_id: 'svc-checkout-api',
        service_name: 'checkout-api',
        jira_component: 'checkout-api',
        compass_component_id: 'cmp-checkout',
        jsm_service: 'checkout-api',
      },
    ]);
    expect(rowToPolicy(policyToRow(original), rowsToServiceMap(rows))).toEqual(original);
  });

  it('reads a corrupted rules_json as a project with no setting', () => {
    const decoded = rowToPolicy({ project_id: 'proj-pay', rules_json: '{"disabledSignals": ' });
    expect(decoded.severityOverrides).toEqual(DEFAULT_POLICY_RULES.severityOverrides);
    expect(decoded.disabledSignals).toEqual([]);
    expect(decoded.defaultWaiverHours).toBe(48);
    expect(decoded.observationMode).toBe(false);
  });

  it('keeps only legal signal codes and severities in the rules', () => {
    const decoded = rowToPolicy({
      project_id: 'proj-pay',
      rules_json: JSON.stringify({
        severityOverrides: { 'COMP-01': 'catastrophic', 'NOPE-1': 'major', 'QUAL-02': 'minor' },
        disabledSignals: ['DOC-01', 'NOPE-2'],
        waiverApprovers: 'not-an-array',
        defaultWaiverHours: 'soon',
      }),
    });
    expect(decoded.severityOverrides).toEqual({ 'QUAL-02': 'minor' });
    expect(decoded.disabledSignals).toEqual(['DOC-01']);
    expect(decoded.waiverApprovers).toEqual([]);
    expect(decoded.defaultWaiverHours).toBe(48);
  });

  it('ignores service map rows without a service id', () => {
    expect(rowsToServiceMap([{ project_id: 'p', service_id: '', service_name: 'ghost', jira_component: null, compass_component_id: null, jsm_service: null }])).toEqual([]);
  });
});

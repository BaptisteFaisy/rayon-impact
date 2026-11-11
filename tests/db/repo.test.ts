import { beforeEach, describe, expect, it } from 'vitest';
import type { Decision, Outcome, Signal, Waiver } from '../../src/types.js';
import {
  ForgeReleaseStore,
  MAX_LIST_LIMIT,
  MAX_SIGNALS_PER_SNAPSHOT,
  clampLimit,
} from '../../src/db/repo.js';
import type { DecisionRow, OutcomeRow, ReleaseSnapshotRow, ServiceMapRow, SignalRow, WaiverRow } from '../../src/db/rows.js';
import {
  decisionToRow,
  outcomeToRow,
  policyToRow,
  signalToRow,
  snapshotToRow,
  waiverToRow,
} from '../../src/db/mapping.js';
import { policy, snapshot } from '../fixtures/builders.js';
import { FakeSql } from './fake-sql.js';

/* ------------------------------------------------------------- fixtures */

function signal(partial: Partial<Signal> = {}): Signal {
  return {
    id: 'COMP-01:issue:PAY-131',
    code: 'COMP-01',
    severity: 'blocking',
    status: 'active',
    subjectType: 'issue',
    subjectId: 'id-pay-131',
    finding: { key: 'signal.comp01.finding', params: { key: 'PAY-131' } },
    evidence: [{ subjectType: 'issue', subjectId: 'id-pay-131', label: { key: 'signal.comp01.finding' } }],
    detectedAt: '2026-11-11T06:00:00.000Z',
    firstSeenAt: '2026-11-09T08:30:00.000Z',
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
    verdictAtDecision: 'go',
    ...partial,
  };
}

function outcome(partial: Partial<Outcome> = {}): Outcome {
  return {
    versionId: 'ver-24',
    checkedAt: '2026-11-14T08:00:00.000Z',
    incidents: [{ key: 'INC-52', severity: 'major' }],
    rollback: false,
    notes: '',
    ...partial,
  };
}

/** Rows exactly as Forge would hand them back for the fixtures above. */
const SNAPSHOT_ROW: ReleaseSnapshotRow = snapshotToRow(snapshot());
const SIGNAL_ROW: SignalRow = signalToRow(signal(), 'snap-1');
const WAIVER_ROW: WaiverRow = waiverToRow(waiver());
const DECISION_ROW: DecisionRow = decisionToRow(decision());
const OUTCOME_ROW: OutcomeRow = outcomeToRow(outcome());
const SERVICE_MAP_ROWS: ServiceMapRow[] = [
  {
    project_id: 'proj-pay',
    service_id: 'svc-checkout-api',
    service_name: 'checkout-api',
    jira_component: 'checkout-api',
    compass_component_id: 'cmp-checkout',
    jsm_service: 'checkout-api',
  },
];

let sql: FakeSql;
let store: ForgeReleaseStore;

beforeEach(() => {
  sql = new FakeSql();
  store = new ForgeReleaseStore(sql);
});

/* ---------------------------------------------------------------- reads */

describe('ForgeReleaseStore — single-row reads', () => {
  it('getSnapshot returns the mapped snapshot', async () => {
    sql.on(/FROM release_snapshot WHERE id = \?/, { rows: [SNAPSHOT_ROW] });
    await expect(store.getSnapshot('snap-1')).resolves.toEqual(snapshot());
    expect(sql.statements[0].params).toEqual(['snap-1']);
  });

  it('getSnapshot returns null when the dossier was never computed', async () => {
    await expect(store.getSnapshot('snap-missing')).resolves.toBeNull();
  });

  it('getOutcome returns null when the 72 h window was never checked', async () => {
    await expect(store.getOutcome('ver-24')).resolves.toBeNull();
  });

  it('getOutcome maps incidents and the rollback flag', async () => {
    sql.on(/FROM outcome WHERE version_id = \?/, { rows: [OUTCOME_ROW] });
    await expect(store.getOutcome('ver-24')).resolves.toEqual(outcome());
  });

  it('getPolicy returns null when the project has no settings yet', async () => {
    await expect(store.getPolicy('proj-pay')).resolves.toBeNull();
  });

  it('getPolicy joins the rules row and its service map rows', async () => {
    sql
      .on(/FROM policy WHERE project_id = \?/, { rows: [policyToRow(policy())] })
      .on(/FROM service_map WHERE project_id = \?/, { rows: SERVICE_MAP_ROWS });
    await expect(store.getPolicy('proj-pay')).resolves.toEqual(policy());
  });

  it('getDossier returns null when the version has no snapshot', async () => {
    await expect(store.getDossier('ver-missing')).resolves.toBeNull();
  });

  it('getDossier assembles the latest snapshot and everything attached to it', async () => {
    sql
      .on(/FROM release_snapshot WHERE version_id = \?/, { rows: [SNAPSHOT_ROW] })
      .on(/FROM signal WHERE snapshot_id = \?/, { rows: [SIGNAL_ROW] })
      .on(/FROM waiver WHERE version_id = \?/, { rows: [WAIVER_ROW] })
      .on(/FROM decision WHERE version_id = \?/, { rows: [DECISION_ROW] })
      .on(/FROM outcome WHERE version_id = \?/, { rows: [OUTCOME_ROW] });
    await expect(store.getDossier('ver-24')).resolves.toEqual({
      snapshot: snapshot(),
      signals: [signal()],
      waivers: [waiver()],
      decisions: [decision()],
      outcome: outcome(),
    });
  });
});

describe('ForgeReleaseStore — list reads', () => {
  it('listSnapshots returns an empty list, never null', async () => {
    await expect(store.listSnapshots('proj-pay', 10)).resolves.toEqual([]);
  });

  it('listSnapshots maps rows and bounds the page size', async () => {
    sql.on(/FROM release_snapshot WHERE project_id = \?/, { rows: [SNAPSHOT_ROW] });
    await expect(store.listSnapshots('proj-pay', 5)).resolves.toEqual([snapshot()]);
    expect(sql.statements[0].params).toEqual(['proj-pay', 5]);
  });

  it('clamps an absurd page size instead of trusting the caller', () => {
    expect(clampLimit(10_000)).toBe(MAX_LIST_LIMIT);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-3)).toBe(1);
    expect(clampLimit(Number.NaN)).toBe(MAX_LIST_LIMIT);
  });

  it('getSignals returns an empty list for an unknown snapshot', async () => {
    await expect(store.getSignals('snap-missing')).resolves.toEqual([]);
  });

  it('getSignals orders blocking signals first, whatever the row order', async () => {
    const minor = signalToRow(signal({ id: 'QUAL-01:issue:PAY-9', code: 'QUAL-01', severity: 'minor' }), 'snap-1');
    sql.on(/FROM signal WHERE snapshot_id = \?/, { rows: [minor, SIGNAL_ROW] });
    const signals = await store.getSignals('snap-1');
    expect(signals.map((entry) => entry.severity)).toEqual(['blocking', 'minor']);
    expect(sql.statements[0].params).toEqual(['snap-1', MAX_SIGNALS_PER_SNAPSHOT]);
  });

  it('getWaivers and getDecisions return empty lists when nothing was recorded', async () => {
    await expect(store.getWaivers('ver-24')).resolves.toEqual([]);
    await expect(store.getDecisions('ver-24')).resolves.toEqual([]);
  });

  it('getWaivers and getDecisions map their rows', async () => {
    sql
      .on(/FROM waiver WHERE version_id = \?/, { rows: [WAIVER_ROW] })
      .on(/FROM decision WHERE version_id = \?/, { rows: [DECISION_ROW] });
    await expect(store.getWaivers('ver-24')).resolves.toEqual([waiver()]);
    await expect(store.getDecisions('ver-24')).resolves.toEqual([decision()]);
  });
});

/* --------------------------------------------------------------- writes */

describe('ForgeReleaseStore — writes', () => {
  it('saveSnapshot upserts the dossier and every signal', async () => {
    await store.saveSnapshot(snapshot(), [signal()]);
    const [snapshotWrite] = sql.matching(/^INSERT INTO release_snapshot/);
    expect(snapshotWrite.sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(snapshotWrite.params[0]).toBe('snap-1');
    const signalWrites = sql.matching(/^INSERT INTO signal/);
    expect(signalWrites).toHaveLength(1);
    expect(signalWrites[0].params).toContain('snap-1');
  });

  it('saveSnapshot closes signals that disappeared, without deleting them', async () => {
    await store.saveSnapshot(snapshot(), [signal()]);
    const [close] = sql.matching(/^UPDATE signal SET status = \?/);
    expect(close.sql).toContain('NOT IN (?)');
    expect(close.params).toEqual(['cleared', 'snap-1', 'active', 'COMP-01:issue:PAY-131']);
    expect(sql.matching(/^DELETE FROM signal/)).toHaveLength(0);
  });

  it('saveSnapshot closes every active signal when the release is now clear', async () => {
    await store.saveSnapshot(snapshot(), []);
    const [close] = sql.matching(/^UPDATE signal SET status = \?/);
    expect(close.sql).not.toContain('NOT IN');
    expect(close.params).toEqual(['cleared', 'snap-1', 'active']);
  });

  it('saveWaiver upserts on the app-provided id (closed, never deleted)', async () => {
    await store.saveWaiver(waiver({ closedAt: '2026-11-12T09:00:00.000Z' }));
    const [write] = sql.matching(/^INSERT INTO waiver/);
    expect(write.sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(write.params).toContain('wai-1');
    expect(write.params).toContain('2026-11-12 09:00:00.000');
  });

  it('saveDecision upserts the decision with the verdict of the moment', async () => {
    await store.saveDecision(decision());
    const [write] = sql.matching(/^INSERT INTO decision/);
    expect(write.params).toContain('go');
    expect(write.sql).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('saveOutcome upserts one outcome per version', async () => {
    await store.saveOutcome(outcome({ rollback: true }));
    const [write] = sql.matching(/^INSERT INTO outcome/);
    expect(write.params[0]).toBe('ver-24');
    expect(write.params).toContain(1);
    expect(write.sql).toContain('ON DUPLICATE KEY UPDATE');
  });

  it('savePolicy upserts the rules and replaces the service map', async () => {
    await store.savePolicy(policy());
    expect(sql.matching(/^INSERT INTO policy/)).toHaveLength(1);
    const [clear] = sql.matching(/^DELETE FROM service_map WHERE project_id = \?/);
    expect(clear.params).toEqual(['proj-pay']);
    expect(sql.matching(/^INSERT INTO service_map/)).toHaveLength(policy().serviceMap.length);
  });
});

/* -------------------------------------------------------------- bounds */

describe('ForgeReleaseStore — query bounds', () => {
  /** Every read and write the store can issue, so the check cannot be gamed. */
  async function exerciseEveryMethod(): Promise<void> {
    await store.getDossier('ver-24');
    await store.getSnapshot('snap-1');
    await store.listSnapshots('proj-pay', 500);
    await store.saveSnapshot(snapshot(), [signal()]);
    await store.getSignals('snap-1');
    await store.getWaivers('ver-24');
    await store.saveWaiver(waiver());
    await store.getDecisions('ver-24');
    await store.saveDecision(decision());
    await store.getOutcome('ver-24');
    await store.saveOutcome(outcome());
    await store.getPolicy('proj-pay');
    await store.savePolicy(policy());
  }

  it('never runs a SELECT without a WHERE and a LIMIT', async () => {
    await exerciseEveryMethod();
    const selects = sql.statements.filter((statement) => statement.sql.startsWith('SELECT'));
    expect(selects.length).toBeGreaterThan(0);
    for (const statement of selects) {
      expect(statement.sql, statement.sql).toContain(' WHERE ');
      expect(statement.sql, statement.sql).toContain(' LIMIT ');
    }
  });

  it('never runs an UPDATE or DELETE without a WHERE', async () => {
    await exerciseEveryMethod();
    const writes = sql.statements.filter((statement) => /^(UPDATE|DELETE)/.test(statement.sql));
    expect(writes.length).toBeGreaterThan(0);
    for (const statement of writes) {
      expect(statement.sql, statement.sql).toContain(' WHERE ');
    }
  });

  it('binds every parameter instead of interpolating values into the SQL', async () => {
    await exerciseEveryMethod();
    for (const statement of sql.statements) {
      expect(statement.sql, statement.sql).not.toContain("'");
    }
  });

  it('lists are always capped by a bound limit, never by the caller alone', async () => {
    await store.listSnapshots('proj-pay', 10_000);
    await store.getSignals('snap-1');
    await store.getWaivers('ver-24');
    await store.getDecisions('ver-24');
    await store.getPolicy('proj-pay');
    const boundedLists = sql.matching(/^SELECT .*LIMIT \?/);
    expect(boundedLists.length).toBeGreaterThan(0);
    for (const statement of boundedLists) {
      const limit = statement.params[statement.params.length - 1];
      expect(typeof limit, statement.sql).toBe('number');
      expect(limit as number).toBeLessThanOrEqual(MAX_SIGNALS_PER_SNAPSHOT);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/db/repo';
import { signalRowKey, signalToRow } from '../../src/db/mapping';
import { defineAllTables, CREATE_SIGNAL_ROW_KEY, DROP_SIGNAL_LEGACY } from '../../src/db/schema';
import { FakeSql } from './fake-sql';
import { signal, snapshot } from '../fixtures/builders';

/**
 * Regression: the `signal` table used to have the content-derived `id` as its
 * primary key, so each recompute overwrote the previous dossier's signals.
 * On the live demo site 30 dossiers out of 31 had zero signals, which silently
 * broke the RI-14 diff and the audit trail.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

describe('signal history is preserved across recomputes', () => {
  it('keys a signal row by (snapshot, signal), not by signal alone', () => {
    const row = signalToRow(signal({ id: 'COMP-01:issue:id-pay-6' }), 'snap-A');
    expect(row.row_key).toBe('snap-A|COMP-01:issue:id-pay-6');
    expect(signalRowKey('COMP-01:issue:id-pay-6', 'snap-A')).toBe(row.row_key);
  });

  it('gives the same signal two different keys in two dossiers', () => {
    const first = signalToRow(signal({ id: 'COMP-01:issue:id-pay-6' }), 'snap-A');
    const second = signalToRow(signal({ id: 'COMP-01:issue:id-pay-6' }), 'snap-B');
    expect(first.row_key).not.toBe(second.row_key);
    expect(first.id).toBe(second.id);
  });

  it('upserts on row_key so a new dossier never overwrites the previous one', async () => {
    const sql = new FakeSql();
    const store = createStore(sql);
    const signals = [signal({ id: 'COMP-01:issue:id-pay-6' })];

    await store.saveSnapshot(snapshot({ id: 'snap-A' }), signals);
    await store.saveSnapshot(snapshot({ id: 'snap-B' }), signals);

    const inserts = sql.matching(/INSERT INTO signal/);
    expect(inserts).toHaveLength(2);
    expect(inserts[0].sql).toContain('row_key');
    expect(inserts[0].sql).toContain('ON DUPLICATE KEY UPDATE');
    expect(inserts[0].sql).not.toContain('row_key = VALUES(row_key)');
    expect(inserts[0].params).toContain('snap-A|COMP-01:issue:id-pay-6');
    expect(inserts[1].params).toContain('snap-B|COMP-01:issue:id-pay-6');
  });

  it('reads a signal by id from the most recent dossier', async () => {
    const sql = new FakeSql();
    const store = createStore(sql);
    await store.getSignalById('COMP-01:issue:id-pay-6');
    const reads = sql.matching(/FROM signal s JOIN release_snapshot/);
    expect(reads).toHaveLength(1);
    expect(reads[0].sql).toMatch(/ORDER BY r\.computed_at DESC LIMIT 1/);
  });

  it('migrates the legacy table: drop, then recreate with row_key', () => {
    const migrations = defineAllTables().map((migration) => migration.name);
    const drop = migrations.indexOf('v002_drop_signal_legacy');
    const create = migrations.indexOf('v003_create_signal_row_key');
    expect(drop).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(drop);
    expect(DROP_SIGNAL_LEGACY).toBe('DROP TABLE IF EXISTS signal');
    expect(CREATE_SIGNAL_ROW_KEY).toContain('row_key VARCHAR(191) NOT NULL PRIMARY KEY');
    expect(CREATE_SIGNAL_ROW_KEY).toContain('INDEX idx_signal_id (id)');
  });
});

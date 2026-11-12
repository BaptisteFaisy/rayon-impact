import { describe, expect, it } from 'vitest';
import { createFailOpenSqlGate, createSqlGate } from '../../src/db/gate';
import type { RecomputeGate } from '../../src/triggers/events';
import { shouldRecompute } from '../../src/engine/debounce';
import { FakeSql } from './fake-sql';

/**
 * The SQL-backed debounce gate (SPEC §12: at most one recompute per minute and
 * per version). The in-memory gate it replaces lived for a single invocation, so
 * nothing was ever coalesced on the live site.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

const VERSION = '10100';
const T0 = '2026-11-12T00:00:00.000Z';
const T0_SQL = '2026-11-12 00:00:00.000';

describe('createSqlGate', () => {
  it('reads nothing for an unknown version', async () => {
    const sql = new FakeSql();
    const gate = createSqlGate(sql);

    await expect(gate.lastQueuedAt(VERSION)).resolves.toBeNull();
    expect(sql.statements[0].params).toEqual([VERSION]);
    expect(sql.statements[0].sql).toMatch(/FROM recalc_pending WHERE version_id = \? LIMIT 1/);
  });

  it('reads back the ISO timestamp it stored', async () => {
    const sql = new FakeSql();
    sql.on(/FROM recalc_pending/, { rows: [{ last_queued_at: T0_SQL }] });
    const gate = createSqlGate(sql);

    await expect(gate.lastQueuedAt(VERSION)).resolves.toBe(T0);
  });

  it('writes one row per version, overwriting the previous stamp', async () => {
    const sql = new FakeSql();
    const gate = createSqlGate(sql);

    await gate.markQueued(VERSION, T0);

    const write = sql.statements[0];
    expect(write.kind).toBe('execute');
    expect(write.sql).toMatch(/INSERT INTO recalc_pending \(version_id, last_queued_at\)/);
    expect(write.sql).toMatch(/ON DUPLICATE KEY UPDATE last_queued_at = VALUES\(last_queued_at\)/);
    expect(write.params).toEqual([VERSION, T0_SQL]);
  });

  it('bounds every statement (no unbounded read)', async () => {
    const sql = new FakeSql();
    const gate = createSqlGate(sql);
    await gate.lastQueuedAt(VERSION);
    await gate.markQueued(VERSION, T0);

    for (const statement of sql.matching(/^SELECT/)) {
      expect(statement.sql).toMatch(/LIMIT \d+/);
    }
    expect(sql.matching(/LIMIT \?/)).toEqual([]);
  });
});

describe('gate + debounce rule together', () => {
  it('queues once per minute per version, whatever the number of events', async () => {
    // A gate whose state outlives the invocation — exactly what the SQL table
    // provides and what the in-memory gate could not.
    const stamps = new Map<string, string>();
    const gate = createSqlGate(new FakeSql());
    const shared: RecomputeGate = {
      async lastQueuedAt(versionId) {
        await gate.lastQueuedAt(versionId);
        return stamps.get(versionId) ?? null;
      },
      async markQueued(versionId, at) {
        stamps.set(versionId, at);
      },
    };

    const events = [
      '2026-11-12T00:00:05.000Z',
      '2026-11-12T00:00:20.000Z',
      '2026-11-12T00:00:50.000Z',
      '2026-11-12T00:01:30.000Z',
    ];
    const queued: string[] = [];
    for (const now of events) {
      const last = await shared.lastQueuedAt(VERSION);
      if (shouldRecompute(last, now, 60)) {
        queued.push(now);
        await shared.markQueued(VERSION, now);
      }
    }

    // 4 événements en 85 secondes → 2 recalculs, pas 4.
    expect(queued).toEqual([events[0], events[3]]);
  });
});

describe('createFailOpenSqlGate', () => {
  it('queues anyway when the gate table is missing, and says so', async () => {
    const sql = new FakeSql();
    sql.failOn(/recalc_pending/, new Error("Table 'recalc_pending' doesn't exist"));
    const warnings: string[] = [];
    const gate = createFailOpenSqlGate(sql, {
      log: (level, message) => {
        if (level === 'warn') warnings.push(message);
      },
    });

    // Perdre un événement laisserait un avis périmé : le gate échoue ouvert.
    await expect(gate.lastQueuedAt(VERSION)).resolves.toBeNull();
    await expect(gate.markQueued(VERSION, T0)).resolves.toBeUndefined();
    expect(warnings).toHaveLength(2);
  });
});

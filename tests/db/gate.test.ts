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
      async deferRequest(request, deferredAt) {
        await gate.deferRequest(request, deferredAt);
      },
      async deferredRequest(versionId) {
        return gate.deferredRequest(versionId);
      },
      async clearDeferred(versionId) {
        await gate.clearDeferred(versionId);
      },
      async listDeferred(limit) {
        return gate.listDeferred(limit);
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

/* ------------------------------------------- demandes reportées (SPEC §12) */

const PROJECT = 'proj-pay';

function deferredRow(reason: string, requestedAt = T0_SQL) {
  return {
    version_id: VERSION,
    project_id: PROJECT,
    reason,
    requested_at: requestedAt,
    deferred_at: requestedAt,
  };
}

describe('createSqlGate — demandes reportées', () => {
  it('coalesce avec la ligne déjà présente : la raison la plus forte l’emporte', async () => {
    const sql = new FakeSql();
    sql.on(/FROM recalc_deferred/, { rows: [deferredRow('schedule')] });
    const gate = createSqlGate(sql);

    await gate.deferRequest(
      { projectId: PROJECT, versionId: VERSION, reason: 'event', requestedAt: '2026-11-12T00:01:00.000Z' },
      '2026-11-12T00:01:00.000Z',
    );

    const write = sql.statements[1];
    expect(write.kind).toBe('execute');
    expect(write.sql).toMatch(/INSERT INTO recalc_deferred/);
    expect(write.sql).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(write.params[2]).toBe('event');
    expect(write.params[3]).toBe('2026-11-12 00:01:00.000');
  });

  it('à raison égale, garde la demande la plus ancienne', async () => {
    const sql = new FakeSql();
    sql.on(/FROM recalc_deferred/, { rows: [deferredRow('event')] });
    const gate = createSqlGate(sql);

    await gate.deferRequest(
      { projectId: PROJECT, versionId: VERSION, reason: 'event', requestedAt: '2026-11-12T00:01:00.000Z' },
      '2026-11-12T00:01:00.000Z',
    );

    expect(sql.statements[1].params[2]).toBe('event');
    expect(sql.statements[1].params[3]).toBe(T0_SQL);
  });

  it('relit la demande reportée avec sa raison et son horodatage ISO', async () => {
    const sql = new FakeSql();
    sql.on(/FROM recalc_deferred/, { rows: [deferredRow('event')] });

    await expect(createSqlGate(sql).deferredRequest(VERSION)).resolves.toEqual({
      projectId: PROJECT,
      versionId: VERSION,
      reason: 'event',
      requestedAt: T0,
    });
  });

  it('rend null sur une ligne illisible plutôt que de lever', async () => {
    const sql = new FakeSql();
    sql.on(/FROM recalc_deferred/, { rows: [deferredRow('raison-inconnue')] });

    await expect(createSqlGate(sql).deferredRequest(VERSION)).resolves.toBeNull();
  });

  it('borne listDeferred avec un entier inliné, jamais un paramètre lié', async () => {
    const sql = new FakeSql();

    await createSqlGate(sql).listDeferred(10);

    expect(sql.statements[0].sql).toMatch(/ORDER BY deferred_at ASC LIMIT 10/);
    expect(sql.statements[0].sql).not.toMatch(/LIMIT \?/);
  });

  it('plafonne listDeferred à la borne partagée', async () => {
    const sql = new FakeSql();

    await createSqlGate(sql).listDeferred(10_000);

    expect(sql.statements[0].sql).toMatch(/LIMIT 50/);
  });

  it('efface la demande reportée d’une version', async () => {
    const sql = new FakeSql();

    await createSqlGate(sql).clearDeferred(VERSION);

    expect(sql.statements[0].kind).toBe('execute');
    expect(sql.statements[0].sql).toMatch(/DELETE FROM recalc_deferred WHERE version_id = \?/);
  });
});

describe('createFailOpenSqlGate — demandes reportées', () => {
  it('une table absente ne fait perdre ni le report, ni la lecture, ni le filet horaire', async () => {
    const sql = new FakeSql();
    sql.failOn(/recalc_deferred/, new Error("Table 'recalc_deferred' doesn't exist"));
    const warnings: string[] = [];
    const gate = createFailOpenSqlGate(sql, {
      log: (level, message) => {
        if (level === 'warn') warnings.push(message);
      },
    });

    await expect(
      gate.deferRequest({ projectId: PROJECT, versionId: VERSION, reason: 'event', requestedAt: T0 }, T0),
    ).resolves.toBeUndefined();
    await expect(gate.deferredRequest(VERSION)).resolves.toBeNull();
    await expect(gate.clearDeferred(VERSION)).resolves.toBeUndefined();
    await expect(gate.listDeferred(50)).resolves.toEqual([]);
    expect(warnings).toHaveLength(4);
  });
});

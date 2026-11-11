/**
 * `ReleaseStore` on Forge SQL — the only persistence adapter of the app.
 *
 * Rules enforced here, and tested in `tests/db/repo.test.ts`:
 * - **Every query is bounded**: no `SELECT` without a `WHERE`, every list has a
 *   hard `LIMIT` (Forge kills a SELECT after 5 s and caps the response at 4 MiB,
 *   R4 §3).
 * - **Absence is normal, not exceptional**: a missing row returns `null`, a
 *   missing set returns `[]`. A freshly installed app can run without a schema
 *   for a moment (R4 §3), so a storage error is the caller's business, never a
 *   reason to invent data.
 * - **No transaction** is documented for Forge SQL (R4 §1.5), so every write is
 *   replayable: `INSERT … ON DUPLICATE KEY UPDATE` on an app-provided id, and
 *   signals that disappear are *closed* (`status = 'cleared'`), never deleted
 *   (SPEC §15, traceability).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { ReleaseStore } from '../ports';
import type {
  CollectedRelease,
  Decision,
  Outcome,
  Policy,
  ReleaseDossier,
  Signal,
  Snapshot,
  Waiver,
} from '../types';
import { SEVERITY_ORDER } from '../types';
import type { SqlClient, SqlParam } from './sql-client';
import { createForgeSqlClient, sqlLimit } from './sql-client';
import type { TableName } from './schema';
import { selectList } from './rows';
import type { CollectionRow, DecisionRow, OutcomeRow, PolicyRow, ReleaseSnapshotRow, ServiceMapRow, SignalRow, WaiverRow } from './rows';
import {
  collectionToRow,
  decisionToRow,
  outcomeToRow,
  policyToRow,
  rowToCollection,
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
} from './mapping';

/** Page size ceiling: keeps every list response far below the 4 MiB cap. */
export const MAX_LIST_LIMIT = 100;

/** A 1 000-issue release stays below this; above it, the dossier is truncated. */
export const MAX_SIGNALS_PER_SNAPSHOT = 500;

/** A service map larger than this is a data-entry problem, not a query plan. */
export const MAX_SERVICE_MAP_ENTRIES = 500;

/** Bounds a caller-supplied page size; never returns 0 or an unbounded value. */
export function clampLimit(limit: number, max: number = MAX_LIST_LIMIT): number {
  if (!Number.isFinite(limit)) return max;
  return Math.min(Math.max(Math.trunc(limit), 1), max);
}

/**
 * Idempotent write: the app owns the primary key, so replaying the same row
 * changes nothing. `VALUES(col)` is the TiDB/MySQL 5.7+ form (R4 §5: no
 * documented upsert helper, this is the portable SQL one).
 */
async function insertOrUpdate(
  client: SqlClient,
  table: TableName,
  row: object,
  keys: readonly string[],
): Promise<number> {
  const entries = Object.entries(row) as [string, SqlParam][];
  const columns = entries.map(([column]) => column);
  const updates = columns
    .filter((column) => !keys.includes(column))
    .map((column) => `${column} = VALUES(${column})`);
  const placeholders = columns.map(() => '?').join(', ');
  const onDuplicate =
    updates.length > 0 ? updates.join(', ') : `${keys[0]} = ${keys[0]}`;
  const statement =
    `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) ` +
    `ON DUPLICATE KEY UPDATE ${onDuplicate}`;
  return client.execute(
    statement,
    entries.map(([, value]) => value),
  );
}

/** Blocking first, then alphabetical: the order the dossier screen expects. */
function bySeverityThenCode(left: Signal, right: Signal): number {
  const delta = SEVERITY_ORDER.indexOf(left.severity) - SEVERITY_ORDER.indexOf(right.severity);
  return delta !== 0 ? delta : left.code.localeCompare(right.code);
}

export class ForgeReleaseStore implements ReleaseStore {
  constructor(private readonly client: SqlClient) {}

  /** One bounded read; `null` when nothing matches. */
  private async first<Row>(statement: string, params: SqlParam[]): Promise<Row | null> {
    const rows = await this.client.query<Row>(statement, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async getSnapshot(snapshotId: string): Promise<Snapshot | null> {
    const row = await this.first<ReleaseSnapshotRow>(
      `SELECT ${selectList('release_snapshot')} FROM release_snapshot WHERE id = ? LIMIT 1`,
      [snapshotId],
    );
    return row ? rowToSnapshot(row) : null;
  }

  /** Newest first: the screens always read the latest dossier (SPEC §12). */
  async listSnapshots(projectId: string, limit: number): Promise<Snapshot[]> {
    const rows = await this.client.query<ReleaseSnapshotRow>(
      `SELECT ${selectList('release_snapshot')} FROM release_snapshot
        WHERE project_id = ? ORDER BY computed_at DESC LIMIT ${sqlLimit(limit, MAX_LIST_LIMIT)}`,
      [projectId],
    );
    return rows.map(rowToSnapshot);
  }

  /**
   * Writes the dossier, then its signals. Signals that were active in this
   * snapshot and are no longer produced are *closed*, not deleted: the diff
   * screen and the audit trail need them (SPEC §15).
   */
  async saveSnapshot(snapshot: Snapshot, signals: Signal[]): Promise<void> {
    await insertOrUpdate(this.client, 'release_snapshot', snapshotToRow(snapshot), ['id']);
    for (const signal of signals) {
      await insertOrUpdate(this.client, 'signal', signalToRow(signal, snapshot.id), ['id']);
    }
    await this.closeMissingSignals(snapshot.id, signals);
  }

  private async closeMissingSignals(snapshotId: string, signals: readonly Signal[]): Promise<void> {
    if (signals.length === 0) {
      await this.client.execute(
        `UPDATE signal SET status = ? WHERE snapshot_id = ? AND status = ?`,
        ['cleared', snapshotId, 'active'],
      );
      return;
    }
    const placeholders = signals.map(() => '?').join(', ');
    await this.client.execute(
      `UPDATE signal SET status = ? WHERE snapshot_id = ? AND status = ? AND id NOT IN (${placeholders})`,
      ['cleared', snapshotId, 'active', ...signals.map((signal) => signal.id)],
    );
  }

  async getSignals(snapshotId: string): Promise<Signal[]> {
    const rows = await this.client.query<SignalRow>(
      `SELECT ${selectList('signal')} FROM signal WHERE snapshot_id = ? ORDER BY code ASC LIMIT ${sqlLimit(MAX_SIGNALS_PER_SNAPSHOT)}`,
      [snapshotId],
    );
    return rows.map(rowToSignal).sort(bySeverityThenCode);
  }

  /** One signal from its id, with the version it belongs to. */
  async getSignalById(signalId: string): Promise<{ versionId: string; signal: Signal } | null> {
    const row = await this.first<SignalRow & { version_id: string }>(
      `SELECT ${selectList('signal')}, r.version_id
         FROM signal s JOIN release_snapshot r ON r.id = s.snapshot_id
        WHERE s.id = ? LIMIT 1`,
      [signalId],
    );
    if (!row) return null;
    return { versionId: row.version_id ?? '', signal: rowToSignal(row) };
  }

  async getWaivers(versionId: string): Promise<Waiver[]> {
    const rows = await this.client.query<WaiverRow>(
      `SELECT ${selectList('waiver')} FROM waiver
        WHERE version_id = ? ORDER BY granted_at DESC LIMIT ${sqlLimit(MAX_LIST_LIMIT)}`,
      [versionId],
    );
    return rows.map(rowToWaiver);
  }

  /** One waiver from its id alone (`close-waiver` has no versionId). */
  async getWaiverById(waiverId: string): Promise<Waiver | null> {
    const row = await this.first<WaiverRow>(
      `SELECT ${selectList('waiver')} FROM waiver WHERE id = ? LIMIT 1`,
      [waiverId],
    );
    return row ? rowToWaiver(row) : null;
  }

  async saveWaiver(waiver: Waiver): Promise<void> {
    await insertOrUpdate(this.client, 'waiver', waiverToRow(waiver), ['id']);
  }

  async getDecisions(versionId: string): Promise<Decision[]> {
    const rows = await this.client.query<DecisionRow>(
      `SELECT ${selectList('decision')} FROM decision
        WHERE version_id = ? ORDER BY decided_at DESC LIMIT ${sqlLimit(MAX_LIST_LIMIT)}`,
      [versionId],
    );
    return rows.map(rowToDecision);
  }

  async saveDecision(decision: Decision): Promise<void> {
    await insertOrUpdate(this.client, 'decision', decisionToRow(decision), ['id']);
  }

  async getOutcome(versionId: string): Promise<Outcome | null> {
    const row = await this.first<OutcomeRow>(
      `SELECT ${selectList('outcome')} FROM outcome WHERE version_id = ? LIMIT 1`,
      [versionId],
    );
    return row ? rowToOutcome(row) : null;
  }

  /** The collection cached with the dossier: the screens never re-collect. */
  async getCollection(
    versionId: string,
  ): Promise<{ collectedAt: string; release: CollectedRelease } | null> {
    const row = await this.first<CollectionRow>(
      `SELECT ${selectList('collection')} FROM collection WHERE version_id = ? LIMIT 1`,
      [versionId],
    );
    if (!row) return null;
    const parsed = rowToCollection(row);
    if (!parsed.release) return null;
    return { collectedAt: parsed.collectedAt, release: parsed.release };
  }

  async saveCollection(
    versionId: string,
    release: CollectedRelease,
    collectedAt: string,
  ): Promise<void> {
    await insertOrUpdate(
      this.client,
      'collection',
      collectionToRow(versionId, release, collectedAt),
      ['version_id'],
    );
  }

  async saveOutcome(outcome: Outcome): Promise<void> {
    await insertOrUpdate(this.client, 'outcome', outcomeToRow(outcome), ['version_id']);
  }

  /** Policy row plus its service map: the map is a table, not a JSON blob. */
  async getPolicy(projectId: string): Promise<Policy | null> {
    const row = await this.first<PolicyRow>(
      `SELECT ${selectList('policy')} FROM policy WHERE project_id = ? LIMIT 1`,
      [projectId],
    );
    if (!row) return null;
    const entries = await this.client.query<ServiceMapRow>(
      `SELECT ${selectList('service_map')} FROM service_map
        WHERE project_id = ? ORDER BY service_id ASC LIMIT ${sqlLimit(MAX_SERVICE_MAP_ENTRIES)}`,
      [projectId],
    );
    return rowToPolicy(row, rowsToServiceMap(entries));
  }

  /**
   * Rules are upserted; the service map is replaced. Without transactions
   * (R4 §1.5) a crash between the DELETE and the INSERTs loses entries — the
   * next save rewrites them, and the settings screen is the only writer.
   */
  async savePolicy(policy: Policy): Promise<void> {
    await insertOrUpdate(this.client, 'policy', policyToRow(policy), ['project_id']);
    await this.client.execute(`DELETE FROM service_map WHERE project_id = ?`, [policy.projectId]);
    for (const row of serviceMapToRows(policy.projectId, policy.serviceMap)) {
      await insertOrUpdate(this.client, 'service_map', row, ['project_id', 'service_id']);
    }
  }

  /**
   * The whole dossier for one version: its latest snapshot plus everything
   * attached to that snapshot and version. `null` when the version was never
   * computed — an empty dossier is not a "go".
   */
  async getDossier(versionId: string): Promise<ReleaseDossier | null> {
    const snapshot = await this.latestSnapshot(versionId);
    if (!snapshot) return null;
    const [signals, waivers, decisions, outcome] = await Promise.all([
      this.getSignals(snapshot.id),
      this.getWaivers(versionId),
      this.getDecisions(versionId),
      this.getOutcome(versionId),
    ]);
    return { snapshot, signals, waivers, decisions, outcome };
  }

  private async latestSnapshot(versionId: string): Promise<Snapshot | null> {
    const row = await this.first<ReleaseSnapshotRow>(
      `SELECT ${selectList('release_snapshot')} FROM release_snapshot
        WHERE version_id = ? ORDER BY computed_at DESC LIMIT 1`,
      [versionId],
    );
    return row ? rowToSnapshot(row) : null;
  }
}

/** The production store; tests pass their own `SqlClient` instead. */
export function createStore(client: SqlClient = createForgeSqlClient()): ReleaseStore {
  return new ForgeReleaseStore(client);
}

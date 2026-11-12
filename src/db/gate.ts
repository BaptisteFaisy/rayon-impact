import type { RecomputeGate } from '../triggers/events';
import type { Logger } from '../ports';
import type { SqlClient } from './sql-client';
import { fromSqlTimestamp, toSqlTimestamp } from './rows';

/**
 * SQL-backed debounce gate for the recompute queue (SPEC §12, step 1).
 *
 * The in-memory gate only lived for one invocation, so nothing was ever
 * coalesced: every Jira event queued a recompute, and each recompute called the
 * hosted model. This implementation shares the state across invocations and
 * warm runtimes.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Row shape of `recalc_pending`. */
interface GateRow {
  last_queued_at: string | null;
}

export function createSqlGate(sql: SqlClient): RecomputeGate {
  return {
    async lastQueuedAt(versionId: string): Promise<string | null> {
      const rows = await sql.query<GateRow>(
        `SELECT last_queued_at FROM recalc_pending WHERE version_id = ? LIMIT 1`,
        [versionId],
      );
      const row = rows[0];
      if (!row) return null;
      return fromSqlTimestamp(row.last_queued_at) ?? null;
    },

    async markQueued(versionId: string, at: string): Promise<void> {
      // One row per version, overwritten: the table stays bounded by the number
      // of tracked versions, never by the number of events.
      await sql.execute(
        `INSERT INTO recalc_pending (version_id, last_queued_at) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE last_queued_at = VALUES(last_queued_at)`,
        [versionId, toSqlTimestamp(at) ?? ''],
      );
    },
  };
}

/**
 * Wraps a gate so that a failure never loses an event.
 *
 * The gate is an optimisation, not a gatekeeper: if `recalc_pending` is missing
 * (the schema is applied by the consumer, and the consumer only runs once an
 * event has been queued — a chicken-and-egg on a fresh install) or Forge SQL is
 * unavailable, the recompute is queued anyway. Losing an event would leave a
 * release with a stale verdict, which is worse than a duplicate recompute.
 */
export function createFailOpenSqlGate(sql: SqlClient, logger: Logger): RecomputeGate {
  const inner = createSqlGate(sql);
  return {
    async lastQueuedAt(versionId: string): Promise<string | null> {
      try {
        return await inner.lastQueuedAt(versionId);
      } catch (error) {
        logger.log('warn', 'gate de regroupement illisible, événement non regroupé', {
          versionId,
          message: error instanceof Error ? error.message : String(error),
        });
        return null;
      }
    },
    async markQueued(versionId: string, at: string): Promise<void> {
      try {
        await inner.markQueued(versionId, at);
      } catch (error) {
        logger.log('warn', 'gate de regroupement non mis à jour', {
          versionId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  };
}

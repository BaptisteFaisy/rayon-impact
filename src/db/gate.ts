import { coalesceRequests } from '../engine/debounce';
import { MAX_DEFERRED_FLUSH } from '../triggers/events';
import type { RecomputeGate } from '../triggers/events';
import type { Logger, RecomputeMessage } from '../ports';
import type { SqlClient } from './sql-client';
import { sqlLimit } from './sql-client';
import { fromSqlTimestamp, selectList, toSqlTimestamp } from './rows';
import type { RecalcDeferredRow } from './rows';

/**
 * SQL-backed debounce gate for the recompute queue (SPEC §12, step 1).
 *
 * The in-memory gate only lived for one invocation, so nothing was ever
 * coalesced: every Jira event queued a recompute, and each recompute called the
 * hosted model. This implementation shares the state across invocations and
 * warm runtimes.
 *
 * Two tables, two roles — and two halves of the gate below:
 *   - `recalc_pending`  — one row per version: when the last recompute was
 *     queued. It is what the 60 s window is measured against.
 *   - `recalc_deferred` — one row per version: the request held back because it
 *     fell inside that window. It is what makes "regroupé" mean *coalesced*
 *     instead of *dropped*: the trailing pass of the consumer reads it, and the
 *     hourly sweep is the safety net.
 *
 * `src/engine/debounce` is imported for `coalesceRequests` only: a pure helper,
 * no I/O, the single implementation of "strongest reason wins, earliest request
 * on a tie".
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Row shape of `recalc_pending`. */
interface GateRow {
  last_queued_at: string | null;
}

/* `recalc_deferred` : la liste de colonnes vient de `rows.ts`, seule source. */
const SELECT_DEFERRED = `SELECT ${selectList('recalc_deferred')} FROM recalc_deferred`;

/** Legal reasons, so a corrupted row can never become a message. */
const REASONS: readonly RecomputeMessage['reason'][] = ['event', 'schedule', 'manual', 'outcome'];

/** A row back to a message; null when it is unreadable (a gate never throws). */
function rowToDeferred(row: RecalcDeferredRow): RecomputeMessage | null {
  const reason = REASONS.find((candidate) => candidate === row.reason);
  const requestedAt = fromSqlTimestamp(row.requested_at);
  if (reason === undefined || requestedAt === null) {
    return null;
  }
  return {
    projectId: row.project_id,
    versionId: row.version_id,
    reason,
    requestedAt,
  };
}

/** Coalesces with the row already held back (`coalesceRequests`, SPEC §12). */
function mergedDeferral(
  known: RecomputeMessage | null,
  request: RecomputeMessage,
): RecomputeMessage {
  return coalesceRequests(known === null ? [] : [known], request)[0];
}

/* ------------------------------------------------- recalc_pending (stamps) */

/** Half of the gate backed by `recalc_pending`: when the last recompute went out. */
function pendingGate(sql: SqlClient): Pick<RecomputeGate, 'lastQueuedAt' | 'markQueued'> {
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

/* --------------------------------------------- recalc_deferred (held back) */

/** Writes the coalesced request, one row per version. */
async function writeDeferral(
  sql: SqlClient,
  merged: RecomputeMessage,
  deferredAt: string,
): Promise<void> {
  await sql.execute(
    `INSERT INTO recalc_deferred (${selectList('recalc_deferred')}) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE project_id = VALUES(project_id), reason = VALUES(reason),
       requested_at = VALUES(requested_at), deferred_at = VALUES(deferred_at)`,
    [
      merged.versionId,
      merged.projectId,
      merged.reason,
      toSqlTimestamp(merged.requestedAt) ?? '',
      toSqlTimestamp(deferredAt) ?? '',
    ],
  );
}

/** Reads back the request held back for one version. */
async function readDeferral(
  sql: SqlClient,
  versionId: string,
): Promise<RecomputeMessage | null> {
  const rows = await sql.query<RecalcDeferredRow>(
    `${SELECT_DEFERRED} WHERE version_id = ? LIMIT 1`,
    [versionId],
  );
  return rows[0] === undefined ? null : rowToDeferred(rows[0]);
}

/** Half of the gate backed by `recalc_deferred`: what the window held back. */
function deferredGate(
  sql: SqlClient,
): Pick<RecomputeGate, 'deferRequest' | 'deferredRequest' | 'clearDeferred' | 'listDeferred'> {
  return {
    async deferRequest(request: RecomputeMessage, deferredAt: string): Promise<void> {
      await writeDeferral(sql, mergedDeferral(await readDeferral(sql, request.versionId), request), deferredAt);
    },

    async deferredRequest(versionId: string): Promise<RecomputeMessage | null> {
      return readDeferral(sql, versionId);
    },

    async clearDeferred(versionId: string): Promise<void> {
      await sql.execute(`DELETE FROM recalc_deferred WHERE version_id = ?`, [versionId]);
    },

    async listDeferred(limit: number): Promise<RecomputeMessage[]> {
      // LIMIT is inlined, never bound: Forge SQL (TiDB) answers ERROR 1210
      // "Incorrect arguments to LIMIT" on a bound parameter.
      const rows = await sql.query<RecalcDeferredRow>(
        `${SELECT_DEFERRED} ORDER BY deferred_at ASC LIMIT ${sqlLimit(limit, MAX_DEFERRED_FLUSH)}`,
      );
      return rows.reduce<RecomputeMessage[]>((kept, row) => {
        const message = rowToDeferred(row);
        return message === null ? kept : [...kept, message];
      }, []);
    },
  };
}

export function createSqlGate(sql: SqlClient): RecomputeGate {
  return { ...pendingGate(sql), ...deferredGate(sql) };
}

/* --------------------------------------------------------------- fail open */

/** Journals a gate failure; a gate never throws towards its caller. */
function warnGate(
  logger: Logger,
  text: string,
  error: unknown,
  meta: Record<string, unknown> = {},
): void {
  logger.log('warn', text, {
    ...meta,
    message: error instanceof Error ? error.message : String(error),
  });
}

/** Stamps half, fail-open. */
function failOpenPending(
  inner: RecomputeGate,
  logger: Logger,
): Pick<RecomputeGate, 'lastQueuedAt' | 'markQueued'> {
  return {
    async lastQueuedAt(versionId: string): Promise<string | null> {
      try {
        return await inner.lastQueuedAt(versionId);
      } catch (error) {
        warnGate(logger, 'gate de regroupement illisible, événement non regroupé', error, { versionId });
        return null;
      }
    },
    async markQueued(versionId: string, at: string): Promise<void> {
      try {
        await inner.markQueued(versionId, at);
      } catch (error) {
        warnGate(logger, 'gate de regroupement non mis à jour', error, { versionId });
      }
    },
  };
}

/** Held-back half, fail-open: a missing table must never lose a request. */
function failOpenDeferred(
  inner: RecomputeGate,
  logger: Logger,
): Pick<RecomputeGate, 'deferRequest' | 'deferredRequest' | 'clearDeferred' | 'listDeferred'> {
  return {
    async deferRequest(request: RecomputeMessage, deferredAt: string): Promise<void> {
      try {
        await inner.deferRequest(request, deferredAt);
      } catch (error) {
        warnGate(logger, 'demande de recalcul non reportée', error, { versionId: request.versionId });
      }
    },
    async deferredRequest(versionId: string): Promise<RecomputeMessage | null> {
      try {
        return await inner.deferredRequest(versionId);
      } catch (error) {
        warnGate(logger, 'demande reportée illisible', error, { versionId });
        return null;
      }
    },
    async clearDeferred(versionId: string): Promise<void> {
      try {
        await inner.clearDeferred(versionId);
      } catch (error) {
        warnGate(logger, 'demande reportée non effacée', error, { versionId });
      }
    },
    async listDeferred(limit: number): Promise<RecomputeMessage[]> {
      try {
        return await inner.listDeferred(limit);
      } catch (error) {
        warnGate(logger, 'demandes reportées illisibles', error, { limit });
        return [];
      }
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
  return { ...failOpenPending(inner, logger), ...failOpenDeferred(inner, logger) };
}

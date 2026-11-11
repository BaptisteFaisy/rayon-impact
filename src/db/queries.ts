import type { SqlClient, SqlParam } from './sql-client';
import { sqlLimit } from './sql-client';

/**
 * Version queries kept out of the `ReleaseStore` interface: they serve the
 * scheduled triggers and the issue context, and adding them to the store would
 * have forced every test double to grow (the interface stays small on purpose).
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Hard cap for the version listings: bounded queries only (SPEC §15). */
export const MAX_VERSION_ROWS = 100;

export interface VersionRow {
  version_id: string;
  version_name: string;
  project_id: string;
  version_released: number | boolean;
  computed_at: string;
}

/** Bounded list of the versions of a project, newest dossier first. */
export async function listVersions(
  sql: SqlClient,
  projectId: string,
  limit = 20,
): Promise<VersionRow[]> {
  const rows = await sql.query<VersionRow>(
    `SELECT version_id, version_name, project_id, version_released, computed_at
       FROM release_snapshot
      WHERE project_id = ?
      GROUP BY version_id, version_name, project_id, version_released, computed_at
      ORDER BY computed_at DESC
      LIMIT ${sqlLimit(limit, MAX_VERSION_ROWS)}`,
    [projectId],
  );
  return rows;
}

/** Versions that are not published yet: the hourly refresh works on those. */
export async function listOpenVersions(
  sql: SqlClient,
  projectId: string,
  limit = 20,
): Promise<VersionRow[]> {
  const rows = await sql.query<VersionRow>(
    `SELECT version_id, version_name, project_id, version_released, computed_at
       FROM release_snapshot
      WHERE project_id = ? AND version_released = 0
      GROUP BY version_id, version_name, project_id, version_released, computed_at
      ORDER BY computed_at DESC
      LIMIT ${sqlLimit(limit, MAX_VERSION_ROWS)}`,
    [projectId],
  );
  return rows;
}

/** Versions published since a date: the 72 h outcome check works on those. */
export async function listReleasedVersions(
  sql: SqlClient,
  projectId: string,
  sinceIso: string,
  limit = 20,
): Promise<VersionRow[]> {
  const rows = await sql.query<VersionRow>(
    `SELECT version_id, version_name, project_id, version_released, computed_at
       FROM release_snapshot
      WHERE project_id = ? AND version_released = 1 AND computed_at >= ?
      GROUP BY version_id, version_name, project_id, version_released, computed_at
      ORDER BY computed_at DESC
      LIMIT ${sqlLimit(limit, MAX_VERSION_ROWS)}`,
    [projectId, sinceIso],
  );
  return rows;
}

/** Versions a ticket belongs to (the issue context panel). */
export async function listVersionsForIssue(
  sql: SqlClient,
  issueId: string,
  limit = 20,
): Promise<VersionRow[]> {
  const rows = await sql.query<VersionRow>(
    `SELECT DISTINCT s.version_id, s.version_name, s.project_id, s.version_released, s.computed_at
       FROM release_snapshot s
       JOIN signal g ON g.snapshot_id = s.id
      WHERE g.subject_type = 'issue' AND g.subject_id = ?
      ORDER BY s.computed_at DESC
      LIMIT ${sqlLimit(limit, MAX_VERSION_ROWS)}`,
    [issueId],
  );
  return rows;
}

/** Convenience: the parameters a bound statement accepts. */
export type QueryParams = readonly SqlParam[];

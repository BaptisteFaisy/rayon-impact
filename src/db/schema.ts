/**
 * Forge SQL schema for the release dossier (SPEC §13).
 *
 * Two facts drive this file:
 * 1. Forge SQL has **no foreign keys** and no cascading delete (SPEC §13,
 *    R4 §3/§5): referential integrity is enforced in `repo.ts`, and every
 *    `*_id` column is a plain `VARCHAR(64)` with an index instead of a FK.
 * 2. There is no table declaration API in TypeScript (`defineTable` does not
 *    exist, R4 §1.1): the schema *is* DDL, applied through `migrationRunner`.
 *    Each statement is idempotent (`CREATE TABLE IF NOT EXISTS` + inline
 *    indexes, which is how MySQL/TiDB makes indexes idempotent — TiDB has no
 *    `CREATE INDEX IF NOT EXISTS`).
 *
 * JSON payloads are stored as TEXT, never as the `JSON` type: it "may not be
 * supported in future versions" (R4 §3) and Forge returns it as a string anyway.
 * Dates are TIMESTAMP; `mapping.ts` owns the ISO-8601 ↔ `YYYY-MM-DD HH:MM:SS.fff`
 * conversion.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import type { DdlMigration, DdlRunner } from './sql-client';
import { forgeDdlRunner } from './sql-client';

/** The seven tables of SPEC §13, in creation order. */
export const TABLES = [
  'release_snapshot',
  'signal',
  'waiver',
  'decision',
  'outcome',
  'policy',
  'service_map',
  // SPEC §12: the collection is cached with the dossier, with its date.
  'collection',
] as const;

export type TableName = (typeof TABLES)[number];

/**
 * Dossiers. SPEC §13 lists the "main" columns; the full `Snapshot` domain type
 * is stored here so a dossier read back is identical to the one written
 * (`rowToSnapshot` must not lose fields silently).
 */
export const CREATE_RELEASE_SNAPSHOT = `
  CREATE TABLE IF NOT EXISTS release_snapshot (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL,
    project_key VARCHAR(64) NOT NULL,
    version_id VARCHAR(64) NOT NULL,
    version_name VARCHAR(255) NOT NULL,
    version_released BOOLEAN NOT NULL,
    computed_at TIMESTAMP NOT NULL,
    verdict VARCHAR(24) NOT NULL,
    confidence VARCHAR(16) NOT NULL,
    coverage_json TEXT,
    counts_json TEXT,
    narrative TEXT,
    narrative_verified BOOLEAN NOT NULL,
    narrative_rejections_json TEXT,
    graph_cached_at TIMESTAMP NULL,
    previous_snapshot_id VARCHAR(64) NULL,
    INDEX idx_snapshot_version (version_id, computed_at),
    INDEX idx_snapshot_project (project_id, computed_at)
  )`;

/** Raised signals. No FK to release_snapshot: integrity lives in the repo. */
export const CREATE_SIGNAL = `
  CREATE TABLE IF NOT EXISTS signal (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    snapshot_id VARCHAR(64) NOT NULL,
    code VARCHAR(48) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    subject_type VARCHAR(24) NOT NULL,
    subject_id VARCHAR(64) NOT NULL,
    finding_json TEXT,
    evidence_json TEXT,
    detected_at TIMESTAMP NOT NULL,
    first_seen_at TIMESTAMP NOT NULL,
    waiver_id VARCHAR(64) NULL,
    INDEX idx_signal_snapshot (snapshot_id),
    INDEX idx_signal_status (status)
  )`;

/** Waivers are closed, never deleted (SPEC §15): `closed_at` instead of a DELETE. */
export const CREATE_WAIVER = `
  CREATE TABLE IF NOT EXISTS waiver (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    version_id VARCHAR(64) NOT NULL,
    signal_code VARCHAR(48) NOT NULL,
    subject_type VARCHAR(24) NOT NULL,
    subject_id VARCHAR(64) NOT NULL,
    granted_by VARCHAR(128) NOT NULL,
    reason TEXT NOT NULL,
    granted_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    closed_at TIMESTAMP NULL,
    closed_reason TEXT,
    INDEX idx_waiver_version (version_id, expires_at)
  )`;

/** Human decisions, kept with the verdict that was on screen at the time. */
export const CREATE_DECISION = `
  CREATE TABLE IF NOT EXISTS decision (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    version_id VARCHAR(64) NOT NULL,
    snapshot_id VARCHAR(64) NOT NULL,
    decided_by VARCHAR(128) NOT NULL,
    decided_at TIMESTAMP NOT NULL,
    decision VARCHAR(16) NOT NULL,
    verdict_at_decision VARCHAR(24) NOT NULL,
    note TEXT,
    INDEX idx_decision_version (version_id, decided_at)
  )`;

/** One outcome per version: `version_id` is the primary key (RI-15). */
export const CREATE_OUTCOME = `
  CREATE TABLE IF NOT EXISTS outcome (
    version_id VARCHAR(64) NOT NULL PRIMARY KEY,
    checked_at TIMESTAMP NOT NULL,
    incidents_json TEXT,
    rollback BOOLEAN NOT NULL,
    notes TEXT
  )`;

/** Per-project settings; `rules_json` holds everything but the service map. */
export const CREATE_POLICY = `
  CREATE TABLE IF NOT EXISTS policy (
    project_id VARCHAR(64) NOT NULL PRIMARY KEY,
    rules_json TEXT
  )`;

/** Service map kept as real columns (SPEC §13), not as a JSON blob. */
export const CREATE_SERVICE_MAP = `
  CREATE TABLE IF NOT EXISTS service_map (
    project_id VARCHAR(64) NOT NULL,
    service_id VARCHAR(64) NOT NULL,
    service_name VARCHAR(255) NOT NULL,
    jira_component VARCHAR(255) NULL,
    compass_component_id VARCHAR(64) NULL,
    jsm_service VARCHAR(255) NULL,
    PRIMARY KEY (project_id, service_id),
    INDEX idx_service_map_component (project_id, jira_component)
  )`;

/** The collection cached with the dossier, so the screens never re-collect. */
export const CREATE_COLLECTION = `
  CREATE TABLE IF NOT EXISTS collection (
    version_id VARCHAR(64) NOT NULL PRIMARY KEY,
    collected_at TIMESTAMP NOT NULL,
    payload_json TEXT
  )`;

/**
 * v002/v003 : la table `signal` historique a `id` comme clé primaire, or `id`
 * est dérivé du contenu (`CODE:subjectType:subjectId`) : chaque recalcul
 * écrasait les signaux du dossier précédent (constaté en réel sur le site de
 * démo — 30 dossiers sur 31 sans aucun signal, donc plus de diff RI-14 possible).
 * La table est recréée avec `row_key = snapshot_id|id` comme clé.
 *
 * Ordre volontaire : v001 (schéma historique) → v002 (drop) → v003 (nouveau
 * schéma). Sur une installation neuve v001 crée puis v002 supprime puis v003
 * recrée : une création perdue, mais un état final identique dans les deux cas.
 * Les données de démo perdues sont régénérées au recalcul suivant.
 */
export const DROP_SIGNAL_LEGACY = 'DROP TABLE IF EXISTS signal';

export const CREATE_SIGNAL_ROW_KEY = `
  CREATE TABLE IF NOT EXISTS signal (
    row_key VARCHAR(191) NOT NULL PRIMARY KEY,
    id VARCHAR(191) NOT NULL,
    snapshot_id VARCHAR(64) NOT NULL,
    code VARCHAR(48) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    status VARCHAR(16) NOT NULL,
    subject_type VARCHAR(24) NOT NULL,
    subject_id VARCHAR(64) NOT NULL,
    finding_json TEXT,
    evidence_json TEXT,
    detected_at TIMESTAMP NOT NULL,
    first_seen_at TIMESTAMP NOT NULL,
    waiver_id VARCHAR(64) NULL,
    INDEX idx_signal_id (id),
    INDEX idx_signal_snapshot (snapshot_id),
    INDEX idx_signal_status (status)
  )`;

/** Migrations appended after the per-table v001 steps, in order. */
export const EXTRA_MIGRATIONS: DdlMigration[] = [
  { name: 'v002_drop_signal_legacy', ddl: DROP_SIGNAL_LEGACY },
  { name: 'v003_create_signal_row_key', ddl: CREATE_SIGNAL_ROW_KEY },
];

/** DDL per table, keyed by table name — the single source for `defineAllTables`. */
export const TABLE_DDL: Record<TableName, string> = {
  release_snapshot: CREATE_RELEASE_SNAPSHOT,
  signal: CREATE_SIGNAL,
  waiver: CREATE_WAIVER,
  decision: CREATE_DECISION,
  outcome: CREATE_OUTCOME,
  policy: CREATE_POLICY,
  service_map: CREATE_SERVICE_MAP,
  collection: CREATE_COLLECTION,
};

/** Stable migration names: re-enqueuing the same name is a no-op in Forge. */
export function migrationName(table: TableName): string {
  return `v001_create_${table}`;
}

/**
 * All schema steps, in dependency order. Idempotent: running it twice enqueues
 * the same names with the same `IF NOT EXISTS` DDL and changes nothing.
 */
export function defineAllTables(): DdlMigration[] {
  return [
    ...TABLES.map((table) => ({ name: migrationName(table), ddl: TABLE_DDL[table] })),
    ...EXTRA_MIGRATIONS,
  ];
}

let schemaRun: Promise<string[]> | null = null;

/**
 * Applies the schema once per warm runtime. A freshly installed app can live
 * without a schema for a moment (R4 §3), so callers keep tolerating "table
 * missing"; this only removes the duplicate-work case.
 */
export function defineSchemaOnce(runner: DdlRunner = forgeDdlRunner): Promise<string[]> {
  schemaRun ??= runner.run(defineAllTables()).catch((error: unknown) => {
    schemaRun = null; // let the next call retry (25 DDL/min ⇒ transient failures)
    throw error;
  });
  return schemaRun;
}

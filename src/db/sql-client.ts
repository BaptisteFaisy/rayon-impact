/**
 * Narrow façade over Forge SQL.
 *
 * `repo.ts` and `schema.ts` only ever see the two interfaces below, so the whole
 * persistence layer is testable with an in-memory fake (`tests/db/fake-sql.ts`).
 *
 * Forge SQL reality check (docs/research/R4-sql-llm.md §1):
 * - the package is `@forge/sql`, NOT `@forge/api`;
 * - there is no `defineTable` / `Table` / `eq` / `in` query builder — the SDK is
 *   raw SQL with positional `?` parameters bound through `sql.prepare(...).bindParams(...)`;
 * - schema changes go through `migrationRunner.enqueue(name, ddl).run()`.
 *
 * `@forge/sql` is not in `package.json` (a shared file this module may not edit),
 * so the runtime binding is loaded lazily through a non-literal specifier: no
 * static import, no compile-time dependency, one single place to swap when the
 * dependency lands.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */

/** Values Forge SQL accepts as a bound `?` parameter. */
export type SqlParam = string | number | boolean | null;

/** The only surface `repo.ts` needs: one bounded query, one bounded write. */
export interface SqlClient {
  /** Runs a SELECT and returns its rows (empty array when nothing matches). */
  query<Row>(statement: string, params?: readonly SqlParam[]): Promise<Row[]>;
  /** Runs INSERT/UPDATE/DELETE and returns the affected row count. */
  execute(statement: string, params?: readonly SqlParam[]): Promise<number>;
}

/** One idempotent DDL step, as `migrationRunner.enqueue` expects it. */
export interface DdlMigration {
  name: string;
  ddl: string;
}

/** Applies DDL steps; Forge's `migrationRunner` in production, a stub in tests. */
export interface DdlRunner {
  run(migrations: readonly DdlMigration[]): Promise<string[]>;
}

/* ------------------------------------------------------------------ Forge */

/**
 * Structural view of the documented `@forge/sql` surface (R4 §1.2 and §1.3).
 * Declared locally on purpose: the package is not installed yet, and these
 * types are what keeps the rest of `src/db` free of Forge imports.
 */
interface ForgeStatement {
  bindParams(...params: unknown[]): ForgeStatement;
  execute(): Promise<{ rows: unknown }>;
}

interface ForgeSqlApi {
  prepare(statement: string): ForgeStatement;
}

interface ForgeMigrationRunner {
  enqueue(name: string, ddl: string): ForgeMigrationRunner;
  run(): Promise<unknown>;
}

/** Named exports only: R4 §1.1 recommends them over the default export. */
interface ForgeSqlModule {
  sql?: ForgeSqlApi;
  migrationRunner?: ForgeMigrationRunner;
}

/** Kept as a plain `string` so TypeScript never tries to resolve the module. */
const FORGE_SQL_MODULE: string = '@forge/sql';

let loaded: Promise<ForgeSqlModule> | null = null;

/** Loads `@forge/sql` once per warm runtime; throws a clear error if absent. */
export function loadForgeSql(): Promise<ForgeSqlModule> {
  loaded ??= import(FORGE_SQL_MODULE).then((mod: unknown) => mod as ForgeSqlModule);
  return loaded;
}

function toRows<Row>(rows: unknown): Row[] {
  return Array.isArray(rows) ? (rows as Row[]) : [];
}

/** UPDATE/INSERT responses come back as one object, SELECT as an array. */
function affectedRowsOf(rows: unknown): number {
  if (Array.isArray(rows)) return rows.length;
  const value = (rows as { affectedRows?: unknown } | null)?.affectedRows;
  return typeof value === 'number' ? value : 0;
}

async function requireSql(): Promise<ForgeSqlApi> {
  const mod = await loadForgeSql();
  const sql = mod.sql;
  if (!sql) {
    throw new Error("Forge SQL is unavailable: '@forge/sql' exports no `sql`.");
  }
  return sql;
}

/** The production `SqlClient`: `sql.prepare(q).bindParams(...).execute()`. */
export function createForgeSqlClient(): SqlClient {
  return {
    async query<Row>(statement: string, params: readonly SqlParam[] = []): Promise<Row[]> {
      const sql = await requireSql();
      const result = await sql.prepare(statement).bindParams(...params).execute();
      return toRows<Row>(result.rows);
    },
    async execute(statement: string, params: readonly SqlParam[] = []): Promise<number> {
      const sql = await requireSql();
      const result = await sql.prepare(statement).bindParams(...params).execute();
      return affectedRowsOf(result.rows);
    },
  };
}

/**
 * The production `DdlRunner`. Forge allows exactly one `migrationRunner` chain
 * per app, so every DDL step is enqueued on the shared instance, in order.
 */
export const forgeDdlRunner: DdlRunner = {
  async run(migrations: readonly DdlMigration[]): Promise<string[]> {
    const mod = await loadForgeSql();
    const runner = mod.migrationRunner;
    if (!runner) {
      throw new Error("Forge SQL is unavailable: '@forge/sql' exports no `migrationRunner`.");
    }
    let chain = runner;
    for (const migration of migrations) {
      chain = chain.enqueue(migration.name, migration.ddl);
    }
    await chain.run();
    return migrations.map((migration) => migration.name);
  },
};

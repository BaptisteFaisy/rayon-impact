/**
 * In-memory `SqlClient` for the persistence tests.
 *
 * It records every statement and replays programmed rows, so `repo.ts` can be
 * tested for what it actually *asks the database* — bounded queries, bound
 * parameters, no unbounded list — without a Forge runtime.
 */
import type { SqlClient, SqlParam } from '../../src/db/sql-client.js';

export interface RecordedStatement {
  /** Whitespace-normalised SQL, so assertions can match across line breaks. */
  sql: string;
  params: readonly SqlParam[];
  kind: 'query' | 'execute';
}

export interface Stub {
  match: RegExp;
  rows?: unknown[];
  affectedRows?: number;
}

export class FakeSql implements SqlClient {
  readonly statements: RecordedStatement[] = [];
  private stubs: Stub[] = [];

  /** Programs the answer of every statement whose SQL matches `match`. */
  on(match: RegExp, result: { rows?: unknown[]; affectedRows?: number } = {}): this {
    this.stubs.push({ match, ...result });
    return this;
  }

  reset(): void {
    this.statements.length = 0;
    this.stubs = [];
  }

  async query<Row>(sql: string, params: readonly SqlParam[] = []): Promise<Row[]> {
    const statement = this.record('query', sql, params);
    return (this.stubFor(statement.sql)?.rows ?? []) as Row[];
  }

  async execute(sql: string, params: readonly SqlParam[] = []): Promise<number> {
    const statement = this.record('execute', sql, params);
    return this.stubFor(statement.sql)?.affectedRows ?? 1;
  }

  /** Statements whose SQL matches `pattern` (no `/g` flag, please). */
  matching(pattern: RegExp): RecordedStatement[] {
    return this.statements.filter((statement) => pattern.test(statement.sql));
  }

  /** Statements that touch `table`, whatever the verb. */
  touching(table: string): RecordedStatement[] {
    return this.matching(new RegExp(`\\b${table}\\b`));
  }

  /** Normalises SQL so stubs and assertions can ignore line breaks. */
  private record(
    kind: RecordedStatement['kind'],
    sql: string,
    params: readonly SqlParam[],
  ): RecordedStatement {
    const statement: RecordedStatement = { sql: sql.replace(/\s+/g, ' ').trim(), params, kind };
    this.statements.push(statement);
    return statement;
  }

  private stubFor(sql: string): Stub | undefined {
    return this.stubs.find((stub) => stub.match.test(sql));
  }
}

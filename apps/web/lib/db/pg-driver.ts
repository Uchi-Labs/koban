import { Pool, type PoolClient, type QueryResultRow } from "pg";
import type { FinanceDbDriver, FinanceDbQueryResult } from "@/lib/db/finance-db-driver";
import { isInDbWriteContext } from "@/lib/db/write-context";

export class PgFinanceDbDriver implements FinanceDbDriver {
  readonly dialect = "postgres" as const;

  private transactionClient: PoolClient | null = null;

  constructor(private readonly pool: Pool) {}

  static open(databaseUrl: string): FinanceDbDriver {
    return new PgFinanceDbDriver(new Pool({ connectionString: databaseUrl }));
  }

  async close(): Promise<void> {
    const client = this.transactionClient;
    this.transactionClient = null;

    if (client) {
      try {
        await client.query("ROLLBACK");
      } finally {
        client.release();
      }
    }

    await this.pool.end();
  }

  async exec(sql: string): Promise<void> {
    for (const statement of splitSqlStatements(sql)) {
      await this.execStatement(statement);
    }
  }

  async query<T>(sql: string, params?: readonly unknown[]): Promise<FinanceDbQueryResult<T>> {
    const transactionClient = this.transactionClient && isInDbWriteContext() ? this.transactionClient : null;
    const result = transactionClient
      ? await transactionClient.query<QueryResultRow>(sql, params ? [...params] : undefined)
      : await this.pool.query<QueryResultRow>(sql, params ? [...params] : undefined);

    return { rows: result.rows as T[] };
  }

  private async execStatement(sql: string): Promise<void> {
    const transactionCommand = sql.trim().toUpperCase();

    if (transactionCommand === "BEGIN") {
      if (!isInDbWriteContext()) {
        throw new Error("Postgres BEGIN outside the serialized write queue is not allowed.");
      }

      if (this.transactionClient) {
        throw new Error("A Postgres transaction is already active.");
      }

      const client = await this.pool.connect();
      try {
        await client.query(sql);
        this.transactionClient = client;
      } catch (error) {
        client.release();
        throw error;
      }
      return;
    }

    if (transactionCommand === "COMMIT" || transactionCommand === "ROLLBACK") {
      const client = this.transactionClient;

      if (!client) {
        await this.pool.query(sql);
        return;
      }

      try {
        await client.query(sql);
      } finally {
        this.transactionClient = null;
        client.release();
      }
      return;
    }

    const transactionClient = this.transactionClient && isInDbWriteContext() ? this.transactionClient : null;
    if (transactionClient) {
      await transactionClient.query(sql);
      return;
    }

    await this.pool.query(sql);
  }
}

function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let dollarQuoteTag: string | null = null;

  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    const next = sql[index + 1];

    if (dollarQuoteTag) {
      if (sql.startsWith(dollarQuoteTag, index)) {
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        dollarQuoteTag = null;
      } else {
        current += char;
      }
      continue;
    }

    if (inSingleQuote) {
      current += char;

      if (char === "'" && next === "'") {
        current += next;
        index += 1;
      } else if (char === "'") {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      current += char;

      if (char === '"' && next === '"') {
        current += next;
        index += 1;
      } else if (char === '"') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (char === "-" && next === "-") {
      const endIndex = sql.indexOf("\n", index + 2);
      const comment = endIndex === -1 ? sql.slice(index) : sql.slice(index, endIndex + 1);
      current += comment;
      index += comment.length - 1;
      continue;
    }

    if (char === "/" && next === "*") {
      const endIndex = sql.indexOf("*/", index + 2);
      const comment = endIndex === -1 ? sql.slice(index) : sql.slice(index, endIndex + 2);
      current += comment;
      index += comment.length - 1;
      continue;
    }

    if (char === "$") {
      const match = sql.slice(index).match(/^\$[A-Za-z0-9_]*\$/);

      if (match) {
        dollarQuoteTag = match[0];
        current += dollarQuoteTag;
        index += dollarQuoteTag.length - 1;
        continue;
      }
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }

    if (char === ";") {
      const statement = current.trim();

      if (statement.length > 0) {
        statements.push(statement);
      }

      current = "";
      continue;
    }

    current += char;
  }

  const finalStatement = current.trim();
  return finalStatement.length > 0 ? [...statements, finalStatement] : statements;
}

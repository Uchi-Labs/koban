import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { isInDbWriteScope } from "@/lib/db/db-write-context";
import type { FinanceDbDriver, FinanceDbQueryResult } from "@/lib/db/finance-db-driver";

export class PgFinanceDbDriver implements FinanceDbDriver {
  readonly dialect = "postgres" as const;

  private transactionClient: PoolClient | null = null;
  // Transactions opened outside the write queue (none known today) keep the
  // legacy route-everything-to-the-client behavior so we never strand their
  // statements on the pool.
  private transactionOutsideWriteScope = false;

  constructor(private readonly pool: Pool) {}

  static open(databaseUrl: string): FinanceDbDriver {
    return new PgFinanceDbDriver(new Pool({ connectionString: databaseUrl }));
  }

  async close(): Promise<void> {
    const client = this.transactionClient;
    this.transactionClient = null;
    this.transactionOutsideWriteScope = false;

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
    const result = this.shouldUseTransactionClient()
      ? await this.transactionClient!.query<QueryResultRow>(sql, params ? [...params] : undefined)
      : await this.pool.query<QueryResultRow>(sql, params ? [...params] : undefined);

    return { rows: result.rows as T[] };
  }

  // A query rides the open transaction only when it comes from the write
  // queue that owns it; concurrent page reads go to the pool so they neither
  // pipeline on one client (pg deprecation) nor serialize behind sync writes.
  private shouldUseTransactionClient(): boolean {
    if (!this.transactionClient) {
      return false;
    }

    return this.transactionOutsideWriteScope || isInDbWriteScope();
  }

  private async execStatement(sql: string): Promise<void> {
    const transactionCommand = sql.trim().toUpperCase();

    if (transactionCommand === "BEGIN") {
      if (this.transactionClient) {
        throw new Error("A Postgres transaction is already active.");
      }

      const client = await this.pool.connect();
      try {
        await client.query(sql);
        this.transactionClient = client;
        this.transactionOutsideWriteScope = !isInDbWriteScope();
        if (this.transactionOutsideWriteScope) {
          console.warn("[pg-driver] BEGIN outside the DB write queue; falling back to legacy shared-client routing.");
        }
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
        this.transactionOutsideWriteScope = false;
        client.release();
      }
      return;
    }

    if (this.shouldUseTransactionClient()) {
      await this.transactionClient!.query(sql);
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

import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { currentDbWriteScope, isInDbWriteScope, type DbWriteScope } from "@/lib/db/db-write-context";
import type { FinanceDbDriver, FinanceDbQueryResult } from "@/lib/db/finance-db-driver";

export class PgTransactionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(
      `Postgres transaction exceeded ${timeoutMs}ms and was rolled back; the rest of this write was refused.`
    );
    this.name = "PgTransactionTimeoutError";
  }
}

export class PgFinanceDbDriver implements FinanceDbDriver {
  readonly dialect = "postgres" as const;

  private transactionClient: PoolClient | null = null;
  // Transactions opened outside the write queue keep the legacy
  // route-everything-to-the-client behaviour so we never strand their statements
  // on the pool. This is a blunt instrument: while it is set, EVERY query in the
  // process rides one client, so a transaction that never commits takes all
  // writes down with it. It fired in practice when a duplicated
  // AsyncLocalStorage made queued writes look un-queued (see db-write-context.ts)
  // — hence the watchdog below, which bounds the blast radius rather than
  // trusting that this state is always exited cleanly.
  private transactionOutsideWriteScope = false;
  private transactionWatchdog: ReturnType<typeof setTimeout> | null = null;
  // The queued write that owns the open transaction. When the watchdog rolls
  // the transaction back it marks this scope, and every later statement from
  // that write fails instead of autocommitting on the pool.
  private transactionScope: DbWriteScope | null = null;
  // Same guard for a legacy transaction opened outside the write queue. Its
  // statements cannot be told apart from unrelated reads, so only its closing
  // COMMIT is refused.
  private legacyTransactionTimeout: PgTransactionTimeoutError | null = null;

  // A transaction opened outside the write queue captures every query in the
  // process, so it gets the tight bound. A queued one only blocks other writes
  // and can legitimately be long (a full ledger replace writes thousands of
  // rows), so it gets headroom — but it is still bounded, because "in the write
  // queue" is no guarantee of reaching COMMIT: an error path that skips the
  // finally, or an abandoned promise, strands the client just the same and every
  // later write routes onto it forever.
  private static readonly OUTSIDE_SCOPE_TRANSACTION_TIMEOUT_MS = 30_000;
  private static readonly QUEUED_TRANSACTION_TIMEOUT_MS = 120_000;

  constructor(private readonly pool: Pool) {}

  static open(databaseUrl: string): FinanceDbDriver {
    return new PgFinanceDbDriver(new Pool({ connectionString: databaseUrl }));
  }

  async close(): Promise<void> {
    this.clearTransactionWatchdog();
    const client = this.transactionClient;
    this.transactionClient = null;
    this.transactionOutsideWriteScope = false;
    this.transactionScope = null;

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
    this.assertWriteNotTimedOut();
    const result = this.shouldUseTransactionClient()
      ? await this.transactionClient!.query<QueryResultRow>(sql, params ? [...params] : undefined)
      : await this.pool.query<QueryResultRow>(sql, params ? [...params] : undefined);

    return { rows: result.rows as T[] };
  }

  async queryCoordinationMetadata<T>(
    sql: string,
    params?: readonly unknown[]
  ): Promise<FinanceDbQueryResult<T>> {
    const result = await this.pool.query<QueryResultRow>(sql, params ? [...params] : undefined);
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

  private assertWriteNotTimedOut(): void {
    const timedOut = currentDbWriteScope()?.abortedTransaction;
    if (timedOut) {
      throw timedOut;
    }
  }

  /**
   * Bound how long ANY transaction can hold the shared client.
   *
   * `transactionClient` is a single process-wide slot. If its owner never
   * reaches COMMIT/ROLLBACK — an abandoned promise, a provider call with no
   * timeout, an error path that skips the finally — the slot stays occupied and
   * every later write is routed onto a client whose transaction will never end.
   * The symptom is brutal and silent: writes hang forever with zero Postgres
   * activity to show for it, reads stay fast because they are cache-served, and
   * only a server restart clears it.
   *
   * A rollback is always safe (it is the absence of a partial commit), so the
   * worst case here is one lost transaction, logged, instead of a dead process.
   * The owning write is marked so its remaining statements, including COMMIT,
   * fail rather than run outside the transaction.
   */
  private armTransactionWatchdog(client: PoolClient, outsideWriteScope: boolean): void {
    this.clearTransactionWatchdog();

    const timeoutMs = outsideWriteScope
      ? PgFinanceDbDriver.OUTSIDE_SCOPE_TRANSACTION_TIMEOUT_MS
      : PgFinanceDbDriver.QUEUED_TRANSACTION_TIMEOUT_MS;

    this.transactionWatchdog = setTimeout(() => {
      if (this.transactionClient !== client) {
        return;
      }

      console.error(
        `[pg-driver] Transaction (${outsideWriteScope ? "outside" : "inside"} the write queue) exceeded ${timeoutMs}ms; rolling back and releasing so writes are not wedged.`
      );

      const timeoutError = new PgTransactionTimeoutError(timeoutMs);
      if (this.transactionScope) {
        this.transactionScope.abortedTransaction = timeoutError;
      } else if (outsideWriteScope) {
        this.legacyTransactionTimeout = timeoutError;
      }

      this.transactionWatchdog = null;
      this.transactionClient = null;
      this.transactionOutsideWriteScope = false;
      this.transactionScope = null;

      void client
        .query("ROLLBACK")
        .catch(() => undefined)
        .finally(() => client.release());
    }, timeoutMs);

    // Never hold the event loop open for a watchdog.
    this.transactionWatchdog.unref?.();
  }

  private clearTransactionWatchdog(): void {
    if (this.transactionWatchdog) {
      clearTimeout(this.transactionWatchdog);
      this.transactionWatchdog = null;
    }
  }

  private async execStatement(sql: string): Promise<void> {
    const transactionCommand = sql.trim().toUpperCase();

    if (currentDbWriteScope()?.abortedTransaction) {
      // The watchdog already rolled this write's transaction back; a ROLLBACK
      // from its error path is a no-op, anything else is refused.
      if (transactionCommand === "ROLLBACK") {
        return;
      }
      this.assertWriteNotTimedOut();
    }

    if (transactionCommand === "BEGIN") {
      if (this.transactionClient) {
        throw new Error("A Postgres transaction is already active.");
      }

      const client = await this.pool.connect();
      try {
        await client.query(sql);
        this.transactionClient = client;
        this.transactionOutsideWriteScope = !isInDbWriteScope();
        this.transactionScope = currentDbWriteScope() ?? null;
        this.legacyTransactionTimeout = null;
        if (this.transactionOutsideWriteScope) {
          // Carry a stack: this state captures every query in the process, so
          // when it shows up the owning call site is the only thing worth knowing.
          console.warn(
            "[pg-driver] BEGIN outside the DB write queue; falling back to legacy shared-client routing.",
            new Error("BEGIN outside write scope").stack
          );
        }

        this.armTransactionWatchdog(client, this.transactionOutsideWriteScope);
      } catch (error) {
        client.release();
        throw error;
      }
      return;
    }

    if (transactionCommand === "COMMIT" || transactionCommand === "ROLLBACK") {
      const client = this.transactionClient;

      if (!client) {
        const legacyTimeout = isInDbWriteScope() ? null : this.legacyTransactionTimeout;
        if (legacyTimeout) {
          this.legacyTransactionTimeout = null;
          if (transactionCommand === "COMMIT") {
            throw legacyTimeout;
          }
          return;
        }
        await this.pool.query(sql);
        return;
      }

      try {
        await client.query(sql);
      } finally {
        this.clearTransactionWatchdog();
        this.transactionClient = null;
        this.transactionOutsideWriteScope = false;
        this.transactionScope = null;
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

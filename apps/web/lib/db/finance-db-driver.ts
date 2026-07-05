export interface FinanceDbQueryResult<T> {
  rows: T[];
}

export type FinanceDbDialect = "pglite" | "postgres";

export interface FinanceDbDriver {
  close(): Promise<void>;
  exec(sql: string): Promise<void>;
  query<T>(sql: string, params?: readonly unknown[]): Promise<FinanceDbQueryResult<T>>;
  readonly dialect: FinanceDbDialect;
}

// Ambient declarations for optional runtime dependencies.
// These packages are dynamically imported and only required
// when the corresponding storage driver is selected.

declare module 'better-sqlite3' {
  namespace Database {
    interface Database {
      exec(sql: string): this;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      prepare(sql: string): any;
      pragma(pragma: string, options?: Record<string, unknown>): unknown;
      close(): void;
    }
  }

  interface DatabaseConstructor {
    new (filename: string, options?: Record<string, unknown>): Database.Database;
    (filename: string, options?: Record<string, unknown>): Database.Database;
  }

  const Database: DatabaseConstructor;
  export = Database;
}

declare module 'pg' {
  namespace pg {
    interface QueryResult {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      rows: any[];
      rowCount: number | null;
    }

    class Pool {
      constructor(config?: { connectionString?: string });
      query(text: string, params?: unknown[]): Promise<QueryResult>;
      end(): Promise<void>;
    }
  }

  export = pg;
}

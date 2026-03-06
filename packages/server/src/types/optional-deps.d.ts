// Ambient declarations for optional runtime dependencies.
// These packages are dynamically imported and only required
// when the corresponding storage driver is selected.

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

import pg from 'pg';

const { Pool } = pg;

export class PgConnection {
  private _pool: pg.Pool | null = null;

  constructor(private readonly connectionUrl: string) {}

  async init(): Promise<void> {
    this._pool = new Pool({ connectionString: this.connectionUrl });
    // Schema creation and migrations are handled by the migration runner
    // (see infrastructure/migrations/)
  }

  get pool(): pg.Pool {
    if (!this._pool) {
      throw new Error('PgConnection not initialized. Call init() first.');
    }
    return this._pool;
  }

  async query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
    return this.pool.query(text, params);
  }

  /**
   * A dedicated client for a transaction (BEGIN … COMMIT must run on one
   * connection). Release it when done.
   */
  async connect(): Promise<{ query(text: string, params?: unknown[]): Promise<pg.QueryResult>; release(): void }> {
    // The installed @types/pg does not surface Pool#connect to tsc here; it exists at runtime.
    return (this.pool as unknown as { connect(): Promise<{ query(text: string, params?: unknown[]): Promise<pg.QueryResult>; release(): void }> }).connect();
  }

  async close(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }
}

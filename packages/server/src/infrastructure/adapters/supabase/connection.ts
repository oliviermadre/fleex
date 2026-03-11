import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import pg from 'pg';

const { Pool } = pg;

export class SupabaseConnection {
  private _client: SupabaseClient | null = null;
  private _pool: pg.Pool | null = null;

  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
    private readonly dbUrl?: string,
  ) {}

  async init(): Promise<void> {
    this._client = createClient(this.url, this.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    if (this.dbUrl) {
      this._pool = new Pool({ connectionString: this.dbUrl });
    }
  }

  get client(): SupabaseClient {
    if (!this._client) {
      throw new Error('SupabaseConnection not initialized. Call init() first.');
    }
    return this._client;
  }

  get canExecuteDDL(): boolean {
    return this._pool !== null;
  }

  async query(text: string, params?: unknown[]): Promise<pg.QueryResult> {
    if (!this._pool) {
      throw new Error(
        'SupabaseConnection has no direct PostgreSQL connection. ' +
        'Set FLEEX_SUPABASE_DB_URL to your Supabase PostgreSQL connection string to run migrations.',
      );
    }
    return this._pool.query(text, params);
  }

  async close(): Promise<void> {
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }
}

import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

import type { LoggerPort } from '../../../application/ports/logger.port.js';
import type { SupabaseClient } from '@supabase/supabase-js';

const { Pool } = pg;

export class SupabaseConnection {
  private _client: SupabaseClient | null = null;
  private _pool: pg.Pool | null = null;
  private _disposeLogger?: () => void;

  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
    private readonly dbUrl?: string,
    private readonly logger?: LoggerPort,
  ) {}

  async init(): Promise<void> {
    const options: Parameters<typeof createClient>[2] = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    };

    if (this.logger && process.env['FLEEX_LOG_SUPABASE_QUERIES'] === 'true') {
      const { createInstrumentedFetch } = await import('./supabase-query-logger.js');
      const instrumented = createInstrumentedFetch(this.logger, this.url);
      options.global = { fetch: instrumented.fetch as unknown as typeof fetch };
      this._disposeLogger = instrumented.dispose;
      this.logger.info('[supabase] Query logging enabled');
    }

    this._client = createClient(this.url, this.serviceRoleKey, options);

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
    this._disposeLogger?.();
    if (this._pool) {
      await this._pool.end();
      this._pool = null;
    }
  }
}

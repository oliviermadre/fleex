import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export class SupabaseConnection {
  private _client: SupabaseClient | null = null;

  constructor(
    private readonly url: string,
    private readonly serviceRoleKey: string,
  ) {}

  async init(): Promise<void> {
    this._client = createClient(this.url, this.serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  get client(): SupabaseClient {
    if (!this._client) {
      throw new Error('SupabaseConnection not initialized. Call init() first.');
    }
    return this._client;
  }
}

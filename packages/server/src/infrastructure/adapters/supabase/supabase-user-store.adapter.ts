import type { SupabaseConnection } from './connection.js';
import type { UserRecord } from '../pg-user-store.adapter.js';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  provider: string;
  provider_id: string;
  preferences: Record<string, unknown>;
  created_at: string;
}

function rowToRecord(row: UserRow): UserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
    provider: row.provider,
    providerId: row.provider_id,
    preferences: row.preferences,
    createdAt: new Date(row.created_at),
  };
}

export class SupabaseUserStore {
  constructor(private readonly conn: SupabaseConnection) {}

  async findById(id: string): Promise<UserRecord | null> {
    const { data, error } = await this.conn.client
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseUserStore.findById failed: ${error.message}`);
    return data ? rowToRecord(data as UserRow) : null;
  }

  async findByProvider(provider: string, providerId: string): Promise<UserRecord | null> {
    const { data, error } = await this.conn.client
      .from('users')
      .select('*')
      .eq('provider', provider)
      .eq('provider_id', providerId)
      .maybeSingle();
    if (error) throw new Error(`SupabaseUserStore.findByProvider failed: ${error.message}`);
    return data ? rowToRecord(data as UserRow) : null;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const { data, error } = await this.conn.client
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();
    if (error) throw new Error(`SupabaseUserStore.findByEmail failed: ${error.message}`);
    return data ? rowToRecord(data as UserRow) : null;
  }

  async upsertFromOAuth(params: {
    provider: string;
    providerId: string;
    email: string;
    name: string | null;
    avatarUrl: string | null;
  }): Promise<UserRecord> {
    const { data, error } = await this.conn.client
      .from('users')
      .upsert(
        {
          email: params.email,
          name: params.name,
          avatar_url: params.avatarUrl,
          provider: params.provider,
          provider_id: params.providerId,
        },
        { onConflict: 'provider,provider_id' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`SupabaseUserStore.upsertFromOAuth failed: ${error.message}`);
    return rowToRecord(data as UserRow);
  }
}

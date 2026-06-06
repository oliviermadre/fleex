import type { KvStorePort } from '../../../application/ports/kv-store.port.js';
import type { SupabaseConnection } from './connection.js';

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000000';

export class SupabaseKvStoreAdapter implements KvStorePort {
  constructor(private readonly connection: SupabaseConnection) {}

  async get(key: string): Promise<string | null> {
    const { data, error } = await this.connection.client
      .from('user_kv')
      .select('value')
      .eq('user_id', DEFAULT_USER_ID)
      .eq('key', key)
      .maybeSingle();
    if (error) throw new Error(`SupabaseKvStore.get failed: ${error.message}`);
    if (!data) return null;
    return JSON.parse(data.value) as string;
  }

  async set(key: string, value: string): Promise<void> {
    const { error } = await this.connection.client.from('user_kv').upsert(
      {
        user_id: DEFAULT_USER_ID,
        key,
        value: JSON.stringify(value),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,key' },
    );
    if (error) throw new Error(`SupabaseKvStore.set failed: ${error.message}`);
  }

  async delete(key: string): Promise<void> {
    const { error } = await this.connection.client
      .from('user_kv')
      .delete()
      .eq('user_id', DEFAULT_USER_ID)
      .eq('key', key);
    if (error) throw new Error(`SupabaseKvStore.delete failed: ${error.message}`);
  }

  async listByPrefix(prefix: string): Promise<{ key: string; value: string }[]> {
    const { data, error } = await this.connection.client
      .from('user_kv')
      .select('key, value')
      .eq('user_id', DEFAULT_USER_ID)
      .like('key', `${prefix}%`);
    if (error) throw new Error(`SupabaseKvStore.listByPrefix failed: ${error.message}`);
    if (!data) return [];
    return data.map((row) => ({
      key: row.key as string,
      value: JSON.parse(row.value) as string,
    }));
  }
}

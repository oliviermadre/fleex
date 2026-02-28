import type { SupabaseConnection } from './connection.js';
import type { GatewayRecord } from '../pg-gateway-store.adapter.js';

interface GatewayRow {
  id: string;
  user_id: string;
  name: string;
  hostname: string | null;
  secret_hash: string;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

function rowToRecord(row: GatewayRow): GatewayRecord {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    hostname: row.hostname,
    status: row.status as 'online' | 'offline',
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    createdAt: new Date(row.created_at),
  };
}

export class SupabaseGatewayStore {
  constructor(
    private readonly conn: SupabaseConnection,
    private readonly userId: string,
  ) {}

  async getAll(): Promise<GatewayRecord[]> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .select('*')
      .eq('user_id', this.userId)
      .order('created_at');
    if (error) throw new Error(`SupabaseGatewayStore.getAll failed: ${error.message}`);
    return (data as GatewayRow[]).map(rowToRecord);
  }

  async getById(id: string): Promise<GatewayRecord | null> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .select('*')
      .eq('id', id)
      .eq('user_id', this.userId)
      .maybeSingle();
    if (error) throw new Error(`SupabaseGatewayStore.getById failed: ${error.message}`);
    return data ? rowToRecord(data as GatewayRow) : null;
  }

  async register(id: string, name: string, hostname: string | null, secretHash: string): Promise<GatewayRecord> {
    const now = new Date().toISOString();
    const { data, error } = await this.conn.client
      .from('gateways')
      .upsert({
        id,
        user_id: this.userId,
        name,
        hostname,
        secret_hash: secretHash,
        status: 'online',
        last_seen_at: now,
      })
      .select('*')
      .single();
    if (error) throw new Error(`SupabaseGatewayStore.register failed: ${error.message}`);
    return rowToRecord(data as GatewayRow);
  }

  async heartbeat(id: string): Promise<boolean> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .update({ status: 'online', last_seen_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', this.userId)
      .select('id');
    if (error) throw new Error(`SupabaseGatewayStore.heartbeat failed: ${error.message}`);
    return (data?.length ?? 0) > 0;
  }

  async markOffline(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('gateways')
      .update({ status: 'offline' })
      .eq('id', id)
      .eq('user_id', this.userId);
    if (error) throw new Error(`SupabaseGatewayStore.markOffline failed: ${error.message}`);
  }

  async markStaleOffline(staleThresholdMs: number): Promise<string[]> {
    const cutoff = new Date(Date.now() - staleThresholdMs).toISOString();
    const { data, error } = await this.conn.client
      .from('gateways')
      .update({ status: 'offline' })
      .eq('user_id', this.userId)
      .eq('status', 'online')
      .lt('last_seen_at', cutoff)
      .select('id');
    if (error) throw new Error(`SupabaseGatewayStore.markStaleOffline failed: ${error.message}`);
    return (data as { id: string }[]).map((r) => r.id);
  }

  /**
   * Verify a gateway's secret by comparing the SHA256 hash.
   * Returns the owning userId on success, null on failure.
   * This intentionally does NOT filter by user_id — it validates the
   * cryptographic identity of the gateway itself during tunnel auth.
   */
  async verifySecret(gatewayId: string, secretHash: string): Promise<string | null> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .select('secret_hash, user_id')
      .eq('id', gatewayId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { secret_hash: string; user_id: string };
    if (row.secret_hash.length !== secretHash.length) return null;
    // Constant-time comparison to prevent timing attacks
    let mismatch = 0;
    for (let i = 0; i < row.secret_hash.length; i++) {
      mismatch |= row.secret_hash.charCodeAt(i) ^ secretHash.charCodeAt(i);
    }
    return mismatch === 0 ? row.user_id : null;
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('gateways')
      .delete()
      .eq('id', id)
      .eq('user_id', this.userId);
    if (error) throw new Error(`SupabaseGatewayStore.remove failed: ${error.message}`);
  }
}

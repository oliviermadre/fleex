import type { Gateway } from '@fleex/shared';
import type { SupabaseConnection } from './connection.js';
import type { LoggerPort } from '../../../application/ports/logger.port.js';

interface GatewayRow {
  id: string;
  user_id: string;
  name: string;
  hostname: string | null;
  public_key: string | null;
  secret_hash: string | null;
  status: string;
  last_seen_at: string | null;
  created_at: string;
}

function rowToGateway(row: GatewayRow): Gateway {
  return {
    id: row.id,
    name: row.name,
    hostname: row.hostname,
    publicKey: row.public_key,
    status: row.status as 'online' | 'offline',
    lastSeenAt: row.last_seen_at,
    createdAt: row.created_at,
  };
}

export class SupabaseGatewayStore {
  constructor(
    private readonly conn: SupabaseConnection,
    private readonly logger: LoggerPort,
  ) {}

  async register(userId: string, name: string, publicKey: string, hostname?: string): Promise<Gateway> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .upsert(
        { user_id: userId, name, hostname: hostname ?? null, public_key: publicKey, secret_hash: '', status: 'offline' },
        { onConflict: 'public_key' },
      )
      .select('*')
      .single();
    if (error) throw new Error(`SupabaseGatewayStore.register failed: ${error.message}`);
    this.logger.info('Gateway registered', { id: data.id, name, publicKey: publicKey.substring(0, 16) + '...' });
    return rowToGateway(data as GatewayRow);
  }

  async getByPublicKey(publicKey: string): Promise<Gateway | null> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .select('*')
      .eq('public_key', publicKey)
      .maybeSingle();
    if (error) throw new Error(`SupabaseGatewayStore.getByPublicKey failed: ${error.message}`);
    return data ? rowToGateway(data as GatewayRow) : null;
  }

  async getById(id: string): Promise<Gateway | null> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseGatewayStore.getById failed: ${error.message}`);
    return data ? rowToGateway(data as GatewayRow) : null;
  }

  async listByUser(userId: string): Promise<Gateway[]> {
    const { data, error } = await this.conn.client
      .from('gateways')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`SupabaseGatewayStore.listByUser failed: ${error.message}`);
    return (data as GatewayRow[]).map(rowToGateway);
  }

  async updateStatus(id: string, status: 'online' | 'offline'): Promise<void> {
    const { error } = await this.conn.client
      .from('gateways')
      .update({ status, last_seen_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`SupabaseGatewayStore.updateStatus failed: ${error.message}`);
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.conn.client
      .from('gateways')
      .delete()
      .eq('id', id);
    if (error) throw new Error(`SupabaseGatewayStore.delete failed: ${error.message}`);
  }
}

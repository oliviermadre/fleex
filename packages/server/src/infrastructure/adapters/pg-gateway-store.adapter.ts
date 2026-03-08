import type { DbPool } from '../database/db.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { Gateway } from '@fleex/shared';

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

export class PgGatewayStore {
  constructor(
    private readonly pool: DbPool,
    private readonly logger: LoggerPort,
  ) {}

  async register(userId: string, name: string, publicKey: string, hostname?: string): Promise<Gateway> {
    const { rows } = await this.pool.query(
      `INSERT INTO gateways (user_id, name, hostname, public_key, secret_hash, status)
       VALUES ($1, $2, $3, $4, '', 'offline')
       ON CONFLICT (public_key) DO UPDATE SET name = EXCLUDED.name, hostname = EXCLUDED.hostname
       RETURNING *`,
      [userId, name, hostname ?? null, publicKey],
    );
    const row = rows[0] as GatewayRow;
    this.logger.info('Gateway registered', { id: row.id, name, publicKey: publicKey.substring(0, 16) + '...' });
    return rowToGateway(row);
  }

  async getByPublicKey(publicKey: string): Promise<Gateway | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gateways WHERE public_key = $1',
      [publicKey],
    );
    if (rows.length === 0) return null;
    return rowToGateway(rows[0] as GatewayRow);
  }

  async getById(id: string): Promise<Gateway | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gateways WHERE id = $1',
      [id],
    );
    if (rows.length === 0) return null;
    return rowToGateway(rows[0] as GatewayRow);
  }

  async listByUser(userId: string): Promise<Gateway[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gateways WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return (rows as GatewayRow[]).map(rowToGateway);
  }

  async updateStatus(id: string, status: 'online' | 'offline'): Promise<void> {
    await this.pool.query(
      'UPDATE gateways SET status = $1, last_seen_at = NOW() WHERE id = $2',
      [status, id],
    );
  }

  async delete(id: string): Promise<void> {
    await this.pool.query('DELETE FROM gateways WHERE id = $1', [id]);
  }
}

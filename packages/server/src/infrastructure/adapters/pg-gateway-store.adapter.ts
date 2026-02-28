import type { DbPool } from '../database/db.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export interface GatewayRecord {
  id: string;
  userId: string;
  name: string;
  hostname: string | null;
  status: 'online' | 'offline';
  lastSeenAt: Date | null;
  createdAt: Date;
}

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

export class PgGatewayStore {
  constructor(
    private readonly pool: DbPool,
    private readonly userId: string,
    private readonly logger: LoggerPort,
  ) {}

  async getAll(): Promise<GatewayRecord[]> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gateways WHERE user_id = $1 ORDER BY created_at',
      [this.userId],
    ) as { rows: GatewayRow[] };
    return rows.map(this.rowToRecord);
  }

  async getById(id: string): Promise<GatewayRecord | null> {
    const { rows } = await this.pool.query(
      'SELECT * FROM gateways WHERE id = $1 AND user_id = $2',
      [id, this.userId],
    ) as { rows: GatewayRow[] };
    return rows[0] ? this.rowToRecord(rows[0]) : null;
  }

  async register(id: string, name: string, hostname: string | null, secretHash: string): Promise<GatewayRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO gateways (id, user_id, name, hostname, secret_hash, status, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, 'online', now())
       ON CONFLICT (id) DO UPDATE SET
         name = $3, hostname = $4, status = 'online', last_seen_at = now()
       RETURNING *`,
      [id, this.userId, name, hostname, secretHash],
    ) as { rows: GatewayRow[] };
    this.logger.info('Gateway registered', { id, name, hostname });
    return this.rowToRecord(rows[0]!);
  }

  async heartbeat(id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE gateways SET status = 'online', last_seen_at = now()
       WHERE id = $1 AND user_id = $2`,
      [id, this.userId],
    );
    return (rowCount ?? 0) > 0;
  }

  async markOffline(id: string): Promise<void> {
    await this.pool.query(
      `UPDATE gateways SET status = 'offline' WHERE id = $1 AND user_id = $2`,
      [id, this.userId],
    );
  }

  async markStaleOffline(staleThresholdMs: number): Promise<string[]> {
    const { rows } = await this.pool.query(
      `UPDATE gateways SET status = 'offline'
       WHERE user_id = $1 AND status = 'online'
         AND last_seen_at < now() - interval '1 millisecond' * $2
       RETURNING id`,
      [this.userId, staleThresholdMs],
    ) as { rows: { id: string }[] };
    return rows.map((r) => r.id);
  }

  /**
   * Verify a gateway's secret by comparing the SHA256 hash.
   * Returns the owning userId on success, null on failure.
   * This intentionally does NOT filter by user_id — it validates the
   * cryptographic identity of the gateway itself during tunnel auth.
   */
  async verifySecret(gatewayId: string, secretHash: string): Promise<string | null> {
    const { rows } = await this.pool.query(
      'SELECT secret_hash, user_id FROM gateways WHERE id = $1',
      [gatewayId],
    ) as { rows: { secret_hash: string; user_id: string }[] };
    if (!rows[0]) return null;
    // Constant-time comparison to prevent timing attacks
    const stored = rows[0].secret_hash;
    if (stored.length !== secretHash.length) return null;
    let mismatch = 0;
    for (let i = 0; i < stored.length; i++) {
      mismatch |= stored.charCodeAt(i) ^ secretHash.charCodeAt(i);
    }
    return mismatch === 0 ? rows[0].user_id : null;
  }

  async remove(id: string): Promise<void> {
    await this.pool.query(
      'DELETE FROM gateways WHERE id = $1 AND user_id = $2',
      [id, this.userId],
    );
  }

  private rowToRecord(row: GatewayRow): GatewayRecord {
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
}

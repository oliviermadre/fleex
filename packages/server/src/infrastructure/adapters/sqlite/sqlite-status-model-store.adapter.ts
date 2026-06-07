import type { StatusModel, StatusColumn, StatusAnchor, StatusOutcome, TicketStatus } from '@fleex/shared';
import type { StatusModelStorePort } from '../../../application/ports/status-model-store.port.js';
import type { SqliteConnection } from './connection.js';

interface Row {
  key: string;
  label: string;
  position: number;
  startable: number;
  active: number;
  terminal: number;
  outcome: string | null;
  anchors: string;
  collapsed_by_default: number;
}

function rowToColumn(r: Row): StatusColumn {
  return {
    key: r.key as TicketStatus,
    label: r.label,
    order: r.position,
    startable: r.startable === 1,
    active: r.active === 1,
    terminal: r.terminal === 1,
    outcome: (r.outcome as StatusOutcome | null) ?? null,
    anchors: JSON.parse(r.anchors) as StatusAnchor[],
    collapsedByDefault: r.collapsed_by_default === 1,
  };
}

export class SqliteStatusModelStoreAdapter implements StatusModelStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getModel(): Promise<StatusModel | null> {
    const rows = this.conn.db
      .prepare('SELECT * FROM status_columns ORDER BY position ASC')
      .all() as Row[];
    if (rows.length === 0) return null;
    return { columns: rows.map(rowToColumn) };
  }

  async saveModel(model: StatusModel): Promise<void> {
    // better-sqlite3 is synchronous; BEGIN/COMMIT on the single connection keeps
    // the replace atomic.
    this.conn.db.exec('BEGIN');
    try {
      this.conn.db.prepare('DELETE FROM status_columns').run();
      const stmt = this.conn.db.prepare(`
        INSERT INTO status_columns
          (key, label, position, startable, active, terminal, outcome, anchors, collapsed_by_default)
        VALUES
          (@key, @label, @position, @startable, @active, @terminal, @outcome, @anchors, @collapsed_by_default)
      `);
      for (const c of model.columns) {
        stmt.run({
          key: c.key,
          label: c.label,
          position: c.order,
          startable: c.startable ? 1 : 0,
          active: c.active ? 1 : 0,
          terminal: c.terminal ? 1 : 0,
          outcome: c.outcome,
          anchors: JSON.stringify(c.anchors),
          collapsed_by_default: c.collapsedByDefault ? 1 : 0,
        });
      }
      this.conn.db.exec('COMMIT');
    } catch (err) {
      this.conn.db.exec('ROLLBACK');
      throw err;
    }
  }
}

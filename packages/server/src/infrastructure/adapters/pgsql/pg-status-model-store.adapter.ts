import type { StatusModel, StatusColumn, StatusAnchor, StatusOutcome, StatusColor, TicketStatus } from '@fleex/shared';
import type { StatusModelStorePort } from '../../../application/ports/status-model-store.port.js';
import type { PgConnection } from './connection.js';

interface Row {
  key: string;
  label: string;
  color: string;
  position: number;
  startable: boolean;
  active: boolean;
  terminal: boolean;
  outcome: string | null;
  anchors: string;
  collapsed_by_default: boolean;
}

function rowToColumn(r: Row): StatusColumn {
  return {
    key: r.key as TicketStatus,
    label: r.label,
    color: r.color as StatusColor,
    order: Number(r.position),
    startable: r.startable,
    active: r.active,
    terminal: r.terminal,
    outcome: (r.outcome as StatusOutcome | null) ?? null,
    anchors: JSON.parse(r.anchors) as StatusAnchor[],
    collapsedByDefault: r.collapsed_by_default,
  };
}

export class PgStatusModelStore implements StatusModelStorePort {
  constructor(private readonly connection: PgConnection) {}

  async getModel(): Promise<StatusModel | null> {
    const { rows } = await this.connection.query(
      'SELECT * FROM status_columns ORDER BY position ASC',
    );
    if (rows.length === 0) return null;
    return { columns: (rows as Row[]).map(rowToColumn) };
  }

  async saveModel(model: StatusModel): Promise<void> {
    // Replace the full set. Statements run sequentially on the pool; saveModel is
    // a rare, pre-validated admin write, so a partial failure is recoverable by
    // re-saving (and bootstrap falls back to the default model if the table is
    // ever left empty).
    await this.connection.query('DELETE FROM status_columns');
    for (const c of model.columns) {
      await this.connection.query(
        `INSERT INTO status_columns
           (key, label, color, position, startable, active, terminal, outcome, anchors, collapsed_by_default)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          c.key,
          c.label,
          c.color,
          c.order,
          c.startable,
          c.active,
          c.terminal,
          c.outcome,
          JSON.stringify(c.anchors),
          c.collapsedByDefault,
        ],
      );
    }
  }
}

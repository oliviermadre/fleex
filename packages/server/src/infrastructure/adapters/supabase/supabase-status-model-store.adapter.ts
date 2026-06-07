import type { StatusModel, StatusColumn, StatusAnchor, StatusOutcome, TicketStatus } from '@fleex/shared';
import type { StatusModelStorePort } from '../../../application/ports/status-model-store.port.js';
import type { SupabaseConnection } from './connection.js';

interface Row {
  key: string;
  label: string;
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
    order: r.position,
    startable: r.startable,
    active: r.active,
    terminal: r.terminal,
    outcome: (r.outcome as StatusOutcome | null) ?? null,
    anchors: JSON.parse(r.anchors) as StatusAnchor[],
    collapsedByDefault: r.collapsed_by_default,
  };
}

export class SupabaseStatusModelStore implements StatusModelStorePort {
  constructor(private readonly connection: SupabaseConnection) {}

  async getModel(): Promise<StatusModel | null> {
    const { data, error } = await this.connection.client
      .from('status_columns')
      .select('*')
      .order('position', { ascending: true });
    if (error) throw new Error(`SupabaseStatusModelStore.getModel failed: ${error.message}`);
    if (!data || data.length === 0) return null;
    return { columns: (data as Row[]).map(rowToColumn) };
  }

  async saveModel(model: StatusModel): Promise<void> {
    const { error: delError } = await this.connection.client
      .from('status_columns')
      .delete()
      .neq('key', '');
    if (delError) throw new Error(`SupabaseStatusModelStore.saveModel (delete) failed: ${delError.message}`);

    const rows = model.columns.map((c) => ({
      key: c.key,
      label: c.label,
      position: c.order,
      startable: c.startable,
      active: c.active,
      terminal: c.terminal,
      outcome: c.outcome,
      anchors: JSON.stringify(c.anchors),
      collapsed_by_default: c.collapsedByDefault,
    }));
    const { error: insError } = await this.connection.client.from('status_columns').insert(rows);
    if (insError) throw new Error(`SupabaseStatusModelStore.saveModel (insert) failed: ${insError.message}`);
  }
}

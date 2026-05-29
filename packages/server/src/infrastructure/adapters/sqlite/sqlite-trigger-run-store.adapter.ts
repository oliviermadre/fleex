import { TriggerRunEntity } from '../../../domain/entities/trigger-run.entity.js';
import type { TriggerRunStorePort } from '../../../application/ports/trigger-run-store.port.js';
import type { TriggerRunStatus } from '@fleex/shared';
import type { SqliteConnection } from './connection.js';

interface Row {
  id: string;
  trigger_id: string;
  scheduled_for: string;
  status: string;
  workflow_run_id: string | null;
  execution_id: string | null;
  workspace_path: string | null;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export class SqliteTriggerRunStoreAdapter implements TriggerRunStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<TriggerRunEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM trigger_runs WHERE id = ?').get(id) as Row | undefined;
    return r ? toEntity(r) : null;
  }

  async getByTrigger(triggerId: string, limit = 50): Promise<TriggerRunEntity[]> {
    const rows = this.conn.db
      .prepare('SELECT * FROM trigger_runs WHERE trigger_id = ? ORDER BY created_at DESC LIMIT ?')
      .all(triggerId, limit) as Row[];
    return rows.map(toEntity);
  }

  async getRunning(): Promise<TriggerRunEntity[]> {
    const rows = this.conn.db.prepare("SELECT * FROM trigger_runs WHERE status = 'running'").all() as Row[];
    return rows.map(toEntity);
  }

  async save(run: TriggerRunEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO trigger_runs
        (id, trigger_id, scheduled_for, status, workflow_run_id, execution_id, workspace_path, error,
         started_at, completed_at, created_at)
      VALUES
        (@id, @trigger_id, @scheduled_for, @status, @workflow_run_id, @execution_id, @workspace_path, @error,
         @started_at, @completed_at, @created_at)
    `).run({
      id: run.id,
      trigger_id: run.triggerId,
      scheduled_for: run.scheduledFor.toISOString(),
      status: run.status,
      workflow_run_id: run.workflowRunId,
      execution_id: run.executionId,
      workspace_path: run.workspacePath,
      error: run.error,
      started_at: run.startedAt?.toISOString() ?? null,
      completed_at: run.completedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(),
    });
  }
}

function toEntity(r: Row): TriggerRunEntity {
  return new TriggerRunEntity(
    r.id,
    r.trigger_id,
    new Date(r.scheduled_for),
    r.status as TriggerRunStatus,
    r.workflow_run_id,
    r.execution_id,
    r.workspace_path,
    r.error,
    r.started_at ? new Date(r.started_at) : null,
    r.completed_at ? new Date(r.completed_at) : null,
    new Date(r.created_at),
  );
}

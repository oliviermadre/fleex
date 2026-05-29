import { TriggerRunEntity } from '../../../domain/entities/trigger-run.entity.js';
import type { TriggerRunStorePort } from '../../../application/ports/trigger-run-store.port.js';
import type { TriggerRunStatus } from '@fleex/shared';
import type { SupabaseConnection } from './connection.js';

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

export class SupabaseTriggerRunStore implements TriggerRunStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<TriggerRunEntity | null> {
    const { data, error } = await this.conn.client.from('trigger_runs').select('*').eq('id', id).maybeSingle();
    if (error) throw new Error(`SupabaseTriggerRunStore.getById failed: ${error.message}`);
    return data ? toEntity(data as Row) : null;
  }

  async getByTrigger(triggerId: string, limit = 50): Promise<TriggerRunEntity[]> {
    const { data, error } = await this.conn.client
      .from('trigger_runs')
      .select('*')
      .eq('trigger_id', triggerId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`SupabaseTriggerRunStore.getByTrigger failed: ${error.message}`);
    return (data as Row[]).map(toEntity);
  }

  async getRunning(): Promise<TriggerRunEntity[]> {
    const { data, error } = await this.conn.client.from('trigger_runs').select('*').eq('status', 'running');
    if (error) throw new Error(`SupabaseTriggerRunStore.getRunning failed: ${error.message}`);
    return (data as Row[]).map(toEntity);
  }

  async save(run: TriggerRunEntity): Promise<void> {
    const { error } = await this.conn.client.from('trigger_runs').upsert({
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
    if (error) throw new Error(`SupabaseTriggerRunStore.save failed: ${error.message}`);
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

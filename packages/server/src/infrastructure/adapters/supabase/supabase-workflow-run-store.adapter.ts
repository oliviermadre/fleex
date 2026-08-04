import { WorkflowRunEntity } from '../../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../../../application/ports/workflow-run-store.port.js';
import type { SupabaseConnection } from './connection.js';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot, RunSubject } from '@fleex/shared';

interface WorkflowRunRow {
  id: string;
  ticket_id: string | null;
  routine_id: string | null;
  subject_snapshot: RunSubject | null;
  workspace_path: string | null;
  template_id: string;
  template_snapshot: WorkflowTemplateSnapshot;
  status: string;
  current_step_id: string | null;
  triggered_by: string;
  triggered_from: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

const ACTIVE: WorkflowRunStatus[] = ['running', 'needs_review'];

function rowToEntity(r: WorkflowRunRow): WorkflowRunEntity {
  return new WorkflowRunEntity(
    r.id,
    r.ticket_id,
    r.template_id,
    r.template_snapshot,
    r.status as WorkflowRunStatus,
    r.current_step_id,
    r.triggered_by,
    r.triggered_from,
    new Date(r.started_at),
    r.completed_at ? new Date(r.completed_at) : null,
    new Date(r.created_at),
    new Date(r.updated_at),
    r.routine_id ?? null,
    r.subject_snapshot ?? null,
    r.workspace_path ?? null,
  );
}

export class SupabaseWorkflowRunStore implements WorkflowRunStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<WorkflowRunEntity | null> {
    const { data, error } = await this.conn.client
      .from('workflow_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseWorkflowRunStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as WorkflowRunRow) : null;
  }

  async getByTicket(ticketId: string): Promise<WorkflowRunEntity[]> {
    const { data, error } = await this.conn.client
      .from('workflow_runs')
      .select('*')
      .eq('ticket_id', ticketId)
      .order('started_at', { ascending: false });
    if (error) throw new Error(`SupabaseWorkflowRunStore.getByTicket failed: ${error.message}`);
    return (data as WorkflowRunRow[]).map(rowToEntity);
  }

  async getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null> {
    const { data, error } = await this.conn.client
      .from('workflow_runs')
      .select('*')
      .eq('ticket_id', ticketId)
      .in('status', ACTIVE)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`SupabaseWorkflowRunStore.getActiveByTicket failed: ${error.message}`);
    return data ? rowToEntity(data as WorkflowRunRow) : null;
  }

  async getByRoutine(routineId: string): Promise<WorkflowRunEntity[]> {
    const { data, error } = await this.conn.client
      .from('workflow_runs')
      .select('*')
      .eq('routine_id', routineId)
      .order('started_at', { ascending: false });
    if (error) throw new Error(`SupabaseWorkflowRunStore.getByRoutine failed: ${error.message}`);
    return (data as WorkflowRunRow[]).map(rowToEntity);
  }

  async getActiveByRoutine(routineId: string): Promise<WorkflowRunEntity | null> {
    const { data, error } = await this.conn.client
      .from('workflow_runs')
      .select('*')
      .eq('routine_id', routineId)
      .in('status', ACTIVE)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`SupabaseWorkflowRunStore.getActiveByRoutine failed: ${error.message}`);
    return data ? rowToEntity(data as WorkflowRunRow) : null;
  }

  async getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]> {
    const { data, error } = await this.conn.client
      .from('workflow_runs')
      .select('*')
      .eq('status', status);
    if (error) throw new Error(`SupabaseWorkflowRunStore.getByStatus failed: ${error.message}`);
    return (data as WorkflowRunRow[]).map(rowToEntity);
  }

  async getAll(): Promise<WorkflowRunEntity[]> {
    const { data, error } = await this.conn.client
      .from('workflow_runs')
      .select('*')
      .order('started_at', { ascending: false });
    if (error) throw new Error(`SupabaseWorkflowRunStore.getAll failed: ${error.message}`);
    return (data as WorkflowRunRow[]).map(rowToEntity);
  }

  async save(run: WorkflowRunEntity): Promise<void> {
    const { error } = await this.conn.client.from('workflow_runs').upsert({
      id: run.id,
      ticket_id: run.ticketId,
      routine_id: run.routineId,
      subject_snapshot: run.subjectSnapshot,
      workspace_path: run.workspacePath,
      template_id: run.templateId,
      template_snapshot: run.templateSnapshot,
      status: run.status,
      current_step_id: run.currentStepId,
      triggered_by: run.triggeredBy,
      triggered_from: run.triggeredFrom,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(),
      updated_at: run.updatedAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseWorkflowRunStore.save failed: ${error.message}`);
  }
}

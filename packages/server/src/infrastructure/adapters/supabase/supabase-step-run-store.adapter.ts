import { StepRunEntity } from '../../../domain/entities/step-run.entity.js';
import type { StepRunStorePort } from '../../../application/ports/step-run-store.port.js';
import type { SupabaseConnection } from './connection.js';
import type { StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';

interface StepRunRow {
  id: string;
  workflow_run_id: string;
  step_id: string;
  attempt: number;
  status: string;
  result: string | null;
  output: StepOutput | null;
  next_edge_id: string | null;
  execution_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

function rowToEntity(r: StepRunRow): StepRunEntity {
  return new StepRunEntity(
    r.id,
    r.workflow_run_id,
    r.step_id,
    r.attempt,
    r.status as StepRunStatus,
    (r.result as StepRunResult | null) ?? null,
    r.output,
    r.next_edge_id,
    r.execution_id,
    r.started_at ? new Date(r.started_at) : null,
    r.completed_at ? new Date(r.completed_at) : null,
    new Date(r.created_at),
  );
}

export class SupabaseStepRunStore implements StepRunStorePort {
  constructor(private readonly conn: SupabaseConnection) {}

  async getById(id: string): Promise<StepRunEntity | null> {
    const { data, error } = await this.conn.client
      .from('step_runs')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(`SupabaseStepRunStore.getById failed: ${error.message}`);
    return data ? rowToEntity(data as StepRunRow) : null;
  }

  async getByWorkflowRun(workflowRunId: string): Promise<StepRunEntity[]> {
    const { data, error } = await this.conn.client
      .from('step_runs')
      .select('*')
      .eq('workflow_run_id', workflowRunId)
      .order('created_at')
      .order('attempt');
    if (error) throw new Error(`SupabaseStepRunStore.getByWorkflowRun failed: ${error.message}`);
    return (data as StepRunRow[]).map(rowToEntity);
  }

  async getLatestForStep(workflowRunId: string, stepId: string): Promise<StepRunEntity | null> {
    const { data, error } = await this.conn.client
      .from('step_runs')
      .select('*')
      .eq('workflow_run_id', workflowRunId)
      .eq('step_id', stepId)
      .order('attempt', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`SupabaseStepRunStore.getLatestForStep failed: ${error.message}`);
    return data ? rowToEntity(data as StepRunRow) : null;
  }

  async save(stepRun: StepRunEntity): Promise<void> {
    const { error } = await this.conn.client.from('step_runs').upsert({
      id: stepRun.id,
      workflow_run_id: stepRun.workflowRunId,
      step_id: stepRun.stepId,
      attempt: stepRun.attempt,
      status: stepRun.status,
      result: stepRun.result,
      output: stepRun.output,
      next_edge_id: stepRun.nextEdgeId,
      execution_id: stepRun.executionId,
      started_at: stepRun.startedAt?.toISOString() ?? null,
      completed_at: stepRun.completedAt?.toISOString() ?? null,
      created_at: stepRun.createdAt.toISOString(),
    });
    if (error) throw new Error(`SupabaseStepRunStore.save failed: ${error.message}`);
  }
}

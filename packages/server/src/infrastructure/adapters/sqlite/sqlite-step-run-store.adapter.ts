import { StepRunEntity } from '../../../domain/entities/step-run.entity.js';
import type { StepRunStorePort } from '../../../application/ports/step-run-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';

interface Row {
  id: string;
  workflow_run_id: string;
  step_id: string;
  attempt: number;
  status: string;
  result: string | null;
  output: string | null;
  next_edge_id: string | null;
  execution_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export class SqliteStepRunStoreAdapter implements StepRunStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<StepRunEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM step_runs WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }

  async getByWorkflowRun(workflowRunId: string): Promise<StepRunEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM step_runs WHERE workflow_run_id = ? ORDER BY created_at ASC, attempt ASC').all(workflowRunId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async getLatestForStep(workflowRunId: string, stepId: string): Promise<StepRunEntity | null> {
    const r = this.conn.db.prepare(`
      SELECT * FROM step_runs WHERE workflow_run_id = ? AND step_id = ?
      ORDER BY attempt DESC LIMIT 1
    `).get(workflowRunId, stepId) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }

  async save(sr: StepRunEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO step_runs
        (id, workflow_run_id, step_id, attempt, status, result, output,
         next_edge_id, execution_id, started_at, completed_at, created_at)
      VALUES
        (@id, @workflow_run_id, @step_id, @attempt, @status, @result, @output,
         @next_edge_id, @execution_id, @started_at, @completed_at, @created_at)
    `).run({
      id: sr.id,
      workflow_run_id: sr.workflowRunId,
      step_id: sr.stepId,
      attempt: sr.attempt,
      status: sr.status,
      result: sr.result,
      output: sr.output ? JSON.stringify(sr.output) : null,
      next_edge_id: sr.nextEdgeId,
      execution_id: sr.executionId,
      started_at: sr.startedAt?.toISOString() ?? null,
      completed_at: sr.completedAt?.toISOString() ?? null,
      created_at: sr.createdAt.toISOString(),
    });
  }

  private toEntity(r: Row): StepRunEntity {
    return new StepRunEntity(
      r.id,
      r.workflow_run_id,
      r.step_id,
      r.attempt,
      r.status as StepRunStatus,
      (r.result as StepRunResult | null) ?? null,
      r.output ? JSON.parse(r.output) as StepOutput : null,
      r.next_edge_id,
      r.execution_id,
      r.started_at ? new Date(r.started_at) : null,
      r.completed_at ? new Date(r.completed_at) : null,
      new Date(r.created_at),
    );
  }
}

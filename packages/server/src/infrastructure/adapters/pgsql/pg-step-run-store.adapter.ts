import { StepRunEntity } from '../../../domain/entities/step-run.entity.js';
import type { StepRunStorePort } from '../../../application/ports/step-run-store.port.js';
import type { PgConnection } from './connection.js';
import type { StepRunStatus, StepRunResult, StepOutput } from '@fleex/shared';

export class PgStepRunStore implements StepRunStorePort {
  constructor(private readonly db: PgConnection) {}

  async getById(id: string): Promise<StepRunEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM step_runs WHERE id = $1', [id]);
    return rows.length > 0 ? rowToStepRun(rows[0]) : null;
  }

  async getByWorkflowRun(workflowRunId: string): Promise<StepRunEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM step_runs WHERE workflow_run_id = $1 ORDER BY created_at ASC, attempt ASC',
      [workflowRunId],
    );
    return rows.map(rowToStepRun);
  }

  async getLatestForStep(workflowRunId: string, stepId: string): Promise<StepRunEntity | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM step_runs WHERE workflow_run_id = $1 AND step_id = $2
       ORDER BY attempt DESC LIMIT 1`,
      [workflowRunId, stepId],
    );
    return rows.length > 0 ? rowToStepRun(rows[0]) : null;
  }

  async getAll(): Promise<StepRunEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM step_runs ORDER BY created_at ASC, attempt ASC',
    );
    return rows.map(rowToStepRun);
  }

  async save(sr: StepRunEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO step_runs (
        id, workflow_run_id, step_id, attempt, status, result, output,
        next_edge_id, execution_id, started_at, completed_at, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        workflow_run_id = $2, step_id = $3, attempt = $4, status = $5, result = $6,
        output = $7, next_edge_id = $8, execution_id = $9, started_at = $10,
        completed_at = $11, created_at = $12`,
      [
        sr.id,
        sr.workflowRunId,
        sr.stepId,
        sr.attempt,
        sr.status,
        sr.result,
        sr.output ? JSON.stringify(sr.output) : null,
        sr.nextEdgeId,
        sr.executionId,
        sr.startedAt?.toISOString() ?? null,
        sr.completedAt?.toISOString() ?? null,
        sr.createdAt.toISOString(),
      ],
    );
  }
}

function rowToStepRun(row: Record<string, unknown>): StepRunEntity {
  // node-pg already parses JSONB; tolerate a TEXT column written by an older instance.
  const raw = row.output;
  let output: StepOutput | null = null;
  if (raw != null) {
    try {
      output = typeof raw === 'string' ? (JSON.parse(raw) as StepOutput) : (raw as StepOutput);
    } catch {
      output = null;
    }
  }

  return new StepRunEntity(
    row.id as string,
    row.workflow_run_id as string,
    row.step_id as string,
    Number(row.attempt),
    row.status as StepRunStatus,
    (row.result as StepRunResult | null) ?? null,
    output,
    (row.next_edge_id as string | null) ?? null,
    (row.execution_id as string | null) ?? null,
    row.started_at ? new Date(row.started_at as string) : null,
    row.completed_at ? new Date(row.completed_at as string) : null,
    new Date(row.created_at as string),
  );
}

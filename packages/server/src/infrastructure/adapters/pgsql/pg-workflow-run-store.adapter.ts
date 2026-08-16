import { WorkflowRunEntity } from '../../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../../../application/ports/workflow-run-store.port.js';
import type { PgConnection } from './connection.js';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot, RunSubject } from '@fleex/shared';
import { readJson } from './pg-json.js';

const ACTIVE = "('running','needs_review')";

export class PgWorkflowRunStore implements WorkflowRunStorePort {
  constructor(private readonly db: PgConnection) {}

  async getById(id: string): Promise<WorkflowRunEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM workflow_runs WHERE id = $1', [id]);
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getByTicket(ticketId: string): Promise<WorkflowRunEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM workflow_runs WHERE ticket_id = $1 ORDER BY started_at DESC', [ticketId],
    );
    return rows.map(rowToEntity);
  }

  async getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM workflow_runs WHERE ticket_id = $1 AND status IN ${ACTIVE} LIMIT 1`, [ticketId],
    );
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getByRoutine(routineId: string): Promise<WorkflowRunEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM workflow_runs WHERE routine_id = $1 ORDER BY started_at DESC', [routineId],
    );
    return rows.map(rowToEntity);
  }

  async getActiveByRoutine(routineId: string): Promise<WorkflowRunEntity | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM workflow_runs WHERE routine_id = $1 AND status IN ${ACTIVE} LIMIT 1`, [routineId],
    );
    return rows.length > 0 ? rowToEntity(rows[0]) : null;
  }

  async getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM workflow_runs WHERE status = $1', [status]);
    return rows.map(rowToEntity);
  }

  async getAll(): Promise<WorkflowRunEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM workflow_runs ORDER BY started_at DESC');
    return rows.map(rowToEntity);
  }

  /**
   * Upsert in place. `step_runs.workflow_run_id` carries an ON DELETE CASCADE,
   * so a delete-then-insert would erase the whole step history on every state
   * transition of the run.
   */
  async save(run: WorkflowRunEntity): Promise<void> {
    await this.db.query(
      `INSERT INTO workflow_runs
         (id, ticket_id, routine_id, parent_run_id, subject_snapshot, workspace_path,
          template_id, template_snapshot, status, current_step_id,
          triggered_by, triggered_from, started_at, completed_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         ticket_id = $2,
         routine_id = $3,
         parent_run_id = $4,
         subject_snapshot = $5,
         workspace_path = $6,
         template_id = $7,
         template_snapshot = $8,
         status = $9,
         current_step_id = $10,
         triggered_by = $11,
         triggered_from = $12,
         started_at = $13,
         completed_at = $14,
         created_at = $15,
         updated_at = $16`,
      [
        run.id,
        run.ticketId,
        run.routineId,
        run.parentRunId,
        run.subjectSnapshot ? JSON.stringify(run.subjectSnapshot) : null,
        run.workspacePath,
        run.templateId,
        JSON.stringify(run.templateSnapshot),
        run.status,
        run.currentStepId,
        run.triggeredBy,
        run.triggeredFrom,
        run.startedAt.toISOString(),
        run.completedAt?.toISOString() ?? null,
        run.createdAt.toISOString(),
        run.updatedAt.toISOString(),
      ],
    );
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntity(r: any): WorkflowRunEntity {
  return new WorkflowRunEntity(
    r.id,
    r.ticket_id,
    r.template_id,
    readJson<WorkflowTemplateSnapshot>(r.template_snapshot)!,
    r.status as WorkflowRunStatus,
    r.current_step_id,
    r.triggered_by,
    r.triggered_from,
    new Date(r.started_at),
    r.completed_at ? new Date(r.completed_at) : null,
    new Date(r.created_at),
    new Date(r.updated_at),
    r.routine_id ?? null,
    readJson<RunSubject>(r.subject_snapshot),
    r.workspace_path ?? null,
    r.parent_run_id ?? null,
  );
}

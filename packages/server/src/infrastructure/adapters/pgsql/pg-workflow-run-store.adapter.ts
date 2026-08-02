import { WorkflowRunEntity } from '../../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../../../application/ports/workflow-run-store.port.js';
import type { PgConnection } from './connection.js';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot } from '@fleex/shared';

const ACTIVE = "('running','needs_review')";

export class PgWorkflowRunStore implements WorkflowRunStorePort {
  constructor(private readonly db: PgConnection) {}

  async getById(id: string): Promise<WorkflowRunEntity | null> {
    const { rows } = await this.db.query('SELECT * FROM workflow_runs WHERE id = $1', [id]);
    return rows.length > 0 ? rowToRun(rows[0]) : null;
  }

  async getByTicket(ticketId: string): Promise<WorkflowRunEntity[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM workflow_runs WHERE ticket_id = $1 ORDER BY started_at DESC',
      [ticketId],
    );
    return rows.map(rowToRun);
  }

  async getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM workflow_runs WHERE ticket_id = $1 AND status IN ${ACTIVE} LIMIT 1`,
      [ticketId],
    );
    return rows.length > 0 ? rowToRun(rows[0]) : null;
  }

  async getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM workflow_runs WHERE status = $1', [status]);
    return rows.map(rowToRun);
  }

  async getAll(): Promise<WorkflowRunEntity[]> {
    const { rows } = await this.db.query('SELECT * FROM workflow_runs ORDER BY started_at DESC');
    return rows.map(rowToRun);
  }

  async save(run: WorkflowRunEntity): Promise<void> {
    // ON CONFLICT DO UPDATE performs an in-place UPDATE — no row is deleted, so the
    // ON DELETE CASCADE on step_runs never fires. A delete-then-insert upsert would
    // erase the entire step history on every run state transition.
    await this.db.query(
      `INSERT INTO workflow_runs (
        id, ticket_id, template_id, template_snapshot, status, current_step_id,
        triggered_by, triggered_from, started_at, completed_at, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        ticket_id = $2, template_id = $3, template_snapshot = $4, status = $5,
        current_step_id = $6, triggered_by = $7, triggered_from = $8,
        started_at = $9, completed_at = $10, created_at = $11, updated_at = $12`,
      [
        run.id,
        run.ticketId,
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

function rowToRun(row: Record<string, unknown>): WorkflowRunEntity {
  // node-pg already parses JSONB; tolerate a TEXT column written by an older instance.
  const raw = row.template_snapshot;
  let snapshot: WorkflowTemplateSnapshot;
  try {
    snapshot = typeof raw === 'string'
      ? (JSON.parse(raw) as WorkflowTemplateSnapshot)
      : (raw as WorkflowTemplateSnapshot);
  } catch {
    snapshot = { steps: [], edges: [], entryStepId: '' } as unknown as WorkflowTemplateSnapshot;
  }

  return new WorkflowRunEntity(
    row.id as string,
    row.ticket_id as string,
    row.template_id as string,
    snapshot,
    row.status as WorkflowRunStatus,
    (row.current_step_id as string | null) ?? null,
    row.triggered_by as string,
    row.triggered_from as string,
    new Date(row.started_at as string),
    row.completed_at ? new Date(row.completed_at as string) : null,
    new Date(row.created_at as string),
    new Date(row.updated_at as string),
  );
}

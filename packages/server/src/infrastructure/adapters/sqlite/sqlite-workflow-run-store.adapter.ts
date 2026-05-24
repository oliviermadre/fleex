import { WorkflowRunEntity } from '../../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../../../application/ports/workflow-run-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot } from '@fleex/shared';

const ACTIVE = "('running','needs_review')";

interface Row {
  id: string;
  ticket_id: string;
  template_id: string;
  template_snapshot: string;
  status: string;
  current_step_id: string | null;
  triggered_by: string;
  triggered_from: string;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export class SqliteWorkflowRunStoreAdapter implements WorkflowRunStorePort {
  constructor(private readonly conn: SqliteConnection) {}

  async getById(id: string): Promise<WorkflowRunEntity | null> {
    const r = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }

  async getByTicket(ticketId: string): Promise<WorkflowRunEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE ticket_id = ? ORDER BY started_at DESC').all(ticketId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null> {
    const r = this.conn.db.prepare(`SELECT * FROM workflow_runs WHERE ticket_id = ? AND status IN ${ACTIVE} LIMIT 1`).get(ticketId) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }

  async getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE status = ?').all(status) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async save(run: WorkflowRunEntity): Promise<void> {
    this.conn.db.prepare(`
      INSERT OR REPLACE INTO workflow_runs
        (id, ticket_id, template_id, template_snapshot, status, current_step_id,
         triggered_by, triggered_from, started_at, completed_at, created_at, updated_at)
      VALUES
        (@id, @ticket_id, @template_id, @template_snapshot, @status, @current_step_id,
         @triggered_by, @triggered_from, @started_at, @completed_at, @created_at, @updated_at)
    `).run({
      id: run.id,
      ticket_id: run.ticketId,
      template_id: run.templateId,
      template_snapshot: JSON.stringify(run.templateSnapshot),
      status: run.status,
      current_step_id: run.currentStepId,
      triggered_by: run.triggeredBy,
      triggered_from: run.triggeredFrom,
      started_at: run.startedAt.toISOString(),
      completed_at: run.completedAt?.toISOString() ?? null,
      created_at: run.createdAt.toISOString(),
      updated_at: run.updatedAt.toISOString(),
    });
  }

  private toEntity(r: Row): WorkflowRunEntity {
    return new WorkflowRunEntity(
      r.id,
      r.ticket_id,
      r.template_id,
      JSON.parse(r.template_snapshot) as WorkflowTemplateSnapshot,
      r.status as WorkflowRunStatus,
      r.current_step_id,
      r.triggered_by,
      r.triggered_from,
      new Date(r.started_at),
      r.completed_at ? new Date(r.completed_at) : null,
      new Date(r.created_at),
      new Date(r.updated_at),
    );
  }
}

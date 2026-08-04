import { WorkflowRunEntity } from '../../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStorePort } from '../../../application/ports/workflow-run-store.port.js';
import type { SqliteConnection } from './connection.js';
import type { WorkflowRunStatus, WorkflowTemplateSnapshot, RunSubject } from '@fleex/shared';

const ACTIVE = "('running','needs_review')";

interface Row {
  id: string;
  ticket_id: string | null;
  routine_id: string | null;
  subject_snapshot: string | null;
  workspace_path: string | null;
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

  async getByRoutine(routineId: string): Promise<WorkflowRunEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE routine_id = ? ORDER BY started_at DESC').all(routineId) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async getActiveByRoutine(routineId: string): Promise<WorkflowRunEntity | null> {
    const r = this.conn.db.prepare(`SELECT * FROM workflow_runs WHERE routine_id = ? AND status IN ${ACTIVE} LIMIT 1`).get(routineId) as Row | undefined;
    return r ? this.toEntity(r) : null;
  }

  async getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_runs WHERE status = ?').all(status) as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async getAll(): Promise<WorkflowRunEntity[]> {
    const rows = this.conn.db.prepare('SELECT * FROM workflow_runs ORDER BY started_at DESC').all() as Row[];
    return rows.map((r) => this.toEntity(r));
  }

  async save(run: WorkflowRunEntity): Promise<void> {
    // Use INSERT … ON CONFLICT DO UPDATE (upsert-in-place) instead of INSERT OR REPLACE.
    // INSERT OR REPLACE performs DELETE + INSERT, which triggers ON DELETE CASCADE on
    // step_runs — erasing all step history every time a run transitions state.
    // ON CONFLICT DO UPDATE performs an in-place UPDATE: no row is deleted, no cascade fires.
    this.conn.db.prepare(`
      INSERT INTO workflow_runs
        (id, ticket_id, routine_id, subject_snapshot, workspace_path,
         template_id, template_snapshot, status, current_step_id,
         triggered_by, triggered_from, started_at, completed_at, created_at, updated_at)
      VALUES
        (@id, @ticket_id, @routine_id, @subject_snapshot, @workspace_path,
         @template_id, @template_snapshot, @status, @current_step_id,
         @triggered_by, @triggered_from, @started_at, @completed_at, @created_at, @updated_at)
      ON CONFLICT(id) DO UPDATE SET
        ticket_id = excluded.ticket_id,
        routine_id = excluded.routine_id,
        subject_snapshot = excluded.subject_snapshot,
        workspace_path = excluded.workspace_path,
        template_id = excluded.template_id,
        template_snapshot = excluded.template_snapshot,
        status = excluded.status,
        current_step_id = excluded.current_step_id,
        triggered_by = excluded.triggered_by,
        triggered_from = excluded.triggered_from,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `).run({
      id: run.id,
      ticket_id: run.ticketId,
      routine_id: run.routineId,
      subject_snapshot: run.subjectSnapshot ? JSON.stringify(run.subjectSnapshot) : null,
      workspace_path: run.workspacePath,
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
      r.routine_id ?? null,
      r.subject_snapshot ? JSON.parse(r.subject_snapshot) as RunSubject : null,
      r.workspace_path ?? null,
    );
  }
}

import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStatus } from '@fleex/shared';

export interface WorkflowRunStorePort {
  getById(id: string): Promise<WorkflowRunEntity | null>;
  getByTicket(ticketId: string): Promise<WorkflowRunEntity[]>;
  getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null>;
  getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]>;
  /** Returns every workflow run, ordered by startedAt DESC. Used by the Execution Log view. */
  getAll(): Promise<WorkflowRunEntity[]>;
  save(run: WorkflowRunEntity): Promise<void>;
}

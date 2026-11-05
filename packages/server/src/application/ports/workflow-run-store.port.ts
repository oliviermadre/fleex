import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStatus } from '@fleex/shared';

export interface WorkflowRunStorePort {
  getById(id: string): Promise<WorkflowRunEntity | null>;
  getByTicket(ticketId: string): Promise<WorkflowRunEntity[]>;
  getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null>;
  getByRoutine(routineId: string): Promise<WorkflowRunEntity[]>;
  getActiveByRoutine(routineId: string): Promise<WorkflowRunEntity | null>;
  getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]>;
  /** Returns every workflow run, ordered by startedAt DESC. Used by the Execution Log view. */
  getAll(): Promise<WorkflowRunEntity[]>;
  /**
   * Runs that overlap `[from, to)`: started before `to` and still running or
   * completed at/after `from`. Bounded read for the agenda — `getAll()` loads every
   * run with its template snapshot and times out on a large instance.
   */
  getOverlapping(from: Date, to: Date): Promise<WorkflowRunEntity[]>;
  save(run: WorkflowRunEntity): Promise<void>;
}

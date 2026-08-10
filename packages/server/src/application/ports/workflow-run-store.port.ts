import type { WorkflowRunEntity } from '../../domain/entities/workflow-run.entity.js';
import type { WorkflowRunStatus } from '@fleex/shared';

export interface WorkflowRunStorePort {
  getById(id: string): Promise<WorkflowRunEntity | null>;
  getByTicket(ticketId: string): Promise<WorkflowRunEntity[]>;
  getActiveByTicket(ticketId: string): Promise<WorkflowRunEntity | null>;
  getByRoutine(routineId: string): Promise<WorkflowRunEntity[]>;
  getActiveByRoutine(routineId: string): Promise<WorkflowRunEntity | null>;
  /**
   * Start time of the routine's most recent run created strictly before
   * `before`, or null when there is none. Feeds the trigger step's
   * `previousRunAt` — keyed on the current run's `createdAt` so a retried step
   * keeps seeing the same value.
   */
  findPreviousRunStartedAt(routineId: string, before: Date): Promise<string | null>;
  getByStatus(status: WorkflowRunStatus): Promise<WorkflowRunEntity[]>;
  /** Returns every workflow run, ordered by startedAt DESC. Used by the Execution Log view. */
  getAll(): Promise<WorkflowRunEntity[]>;
  save(run: WorkflowRunEntity): Promise<void>;
}

import type { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';
import type { AgentExecution } from '@fleex/shared';

export interface ThreadStorePort {
  getById(id: string): Promise<AgentThreadEntity | null>;
  /** Newest first. */
  getByTicket(ticketId: string): Promise<AgentThreadEntity[]>;
  getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null>;
  /** Threads whose status is running or waiting, across tickets. */
  getOpen(): Promise<AgentThreadEntity[]>;
  save(thread: AgentThreadEntity): Promise<void>;
  /**
   * Get all executions (runs) associated with a thread that match the given statuses.
   * Queries through: thread → comments (by thread_id) → mentions (by comment_id) → executions (by mention_id).
   * Used for auto-terminating runs when concluding a thread.
   */
  getRunsByThreadAndStatus(threadId: string, activeStatuses: string[]): Promise<AgentExecution[]>;
}

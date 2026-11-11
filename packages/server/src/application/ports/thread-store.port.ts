import type { AgentThreadEntity } from '../../domain/entities/agent-thread.entity.js';

export interface ThreadStorePort {
  getById(id: string): Promise<AgentThreadEntity | null>;
  /** Newest first. */
  getByTicket(ticketId: string): Promise<AgentThreadEntity[]>;
  getByCurrentMentionId(mentionId: string): Promise<AgentThreadEntity | null>;
  /** Threads whose status is running or waiting, across tickets. */
  getOpen(): Promise<AgentThreadEntity[]>;
  save(thread: AgentThreadEntity): Promise<void>;
}

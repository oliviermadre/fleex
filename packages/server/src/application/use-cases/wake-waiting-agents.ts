import type { MentionExecutionMode } from '@fleex/shared';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { ExecuteAgentUseCase } from './execute-agent.js';
import type { LoggerPort } from '../ports/logger.port.js';

export class WakeWaitingAgentsUseCase {
  constructor(
    private readonly mentionStore: MentionStorePort,
    private readonly executeAgent: ExecuteAgentUseCase,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Wake up all agents that are waiting_for_info on a ticket.
   * Called when new content (comments, deliverables) is added to a ticket.
   *
   * @param ticketId - The ticket that received new content
   * @param excludeAgentNames - Agents NOT to wake. Includes the comment author
   *   (avoids self-wake loops) AND any agent freshly re-mentioned by the same
   *   comment — a re-mention is a NEW queued request for that agent, not an
   *   answer to its pending question, so its waiting thread must stay parked.
   * @param executionMode - If provided, update the waiting mention's execution mode before waking
   */
  async execute(ticketId: string, excludeAgentNames?: readonly string[], executionMode?: MentionExecutionMode): Promise<void> {
    const excluded = new Set(excludeAgentNames ?? []);
    const waitingMentions = await this.mentionStore.getWaitingByTicket(ticketId);

    for (const mention of waitingMentions) {
      if (excluded.has(mention.targetAgent)) {
        continue;
      }

      if (executionMode) {
        mention.executionMode = executionMode;
      }

      try {
        await this.executeAgent.wakeUp(mention);
      } catch (err) {
        this.logger.warn('Failed to wake waiting agent', {
          mentionId: mention.id,
          targetAgent: mention.targetAgent,
          ticketId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
}

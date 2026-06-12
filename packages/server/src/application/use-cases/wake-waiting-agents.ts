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
   *
   * The execution mode is NOT passed in here: it is resolved from the ticket's
   * conversation-scoped config when the mention is re-acknowledged in
   * `executeForMention`, so a woken agent always picks up the current settings.
   */
  async execute(ticketId: string, excludeAgentNames?: readonly string[]): Promise<void> {
    const excluded = new Set(excludeAgentNames ?? []);
    const waitingMentions = await this.mentionStore.getWaitingByTicket(ticketId);

    for (const mention of waitingMentions) {
      if (excluded.has(mention.targetAgent)) {
        continue;
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

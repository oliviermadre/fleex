import type { TicketSummaryRef } from '@fleex/shared';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

const MAX_SUMMARIES = 4;

/**
 * Retrieves relevant ticket summaries for context injection.
 *
 * Scoring strategy (MVP — labels + recency, no embeddings):
 * - +2 per shared tag with the current ticket
 * - +1 if same board (likely same repo/domain)
 * - +0.5 if same assignee
 * - Recency boost: 1 / (1 + daysSinceClosed / 30)
 */
export class GetRelevantSummariesUseCase {
  constructor(
    private readonly deliverableStore: DeliverableStorePort,
    private readonly ticketStore: TicketStorePort,
  ) {}

  async execute(params: {
    ticketId: string;
    limit?: number;
  }): Promise<TicketSummaryRef[]> {
    const limit = params.limit ?? MAX_SUMMARIES;

    const currentTicket = await this.ticketStore.getTicketById(params.ticketId);
    if (!currentTicket) return [];

    const allSummaries = await this.deliverableStore.getAllByType('ticket-summary');
    if (allSummaries.length === 0) return [];

    // Filter out summary for the current ticket
    const candidates = allSummaries.filter((s) => s.ticketId !== params.ticketId);
    if (candidates.length === 0) return [];

    // Load ticket data for each candidate to compute scores
    const scored: Array<{
      summary: typeof candidates[0];
      ticket: TicketEntity;
      score: number;
    }> = [];

    const currentTags = new Set(currentTicket.tags);

    for (const summary of candidates) {
      if (!summary.ticketId) continue;
      const ticket = await this.ticketStore.getTicketById(summary.ticketId);
      if (!ticket) continue;

      let score = 0;

      // Tag overlap: +2 per shared tag
      for (const tag of ticket.tags) {
        if (currentTags.has(tag)) score += 2;
      }

      // Same board: +1
      if (ticket.boardId === currentTicket.boardId) score += 1;

      // Same assignee: +0.5
      if (ticket.assignee && ticket.assignee === currentTicket.assignee) score += 0.5;

      // Recency boost
      const daysSinceClosed = (Date.now() - summary.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
      score += 1 / (1 + daysSinceClosed / 30);

      scored.push({ summary, ticket, score });
    }

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // If fewer than 2 have non-trivial base score (excluding recency), fallback to most recent
    const nonTrivialCount = scored.filter((s) => {
      let baseScore = 0;
      for (const tag of s.ticket.tags) {
        if (currentTags.has(tag)) baseScore += 2;
      }
      if (s.ticket.boardId === currentTicket.boardId) baseScore += 1;
      if (s.ticket.assignee && s.ticket.assignee === currentTicket.assignee) baseScore += 0.5;
      return baseScore > 0;
    }).length;

    let selected: typeof scored;
    if (nonTrivialCount < 2) {
      // Fallback: take the 2 most recent summaries regardless of score
      selected = scored
        .sort((a, b) => b.summary.updatedAt.getTime() - a.summary.updatedAt.getTime())
        .slice(0, Math.min(limit, 2));
    } else {
      selected = scored.slice(0, limit);
    }

    return selected.map((s) => ({
      ticketId: s.ticket.id,
      ticketTitle: s.ticket.title,
      ticketStatus: s.ticket.status,
      content: s.summary.content,
      updatedAt: s.summary.updatedAt.toISOString(),
    }));
  }
}

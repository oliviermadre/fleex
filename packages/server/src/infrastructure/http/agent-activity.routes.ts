import type { FastifyInstance } from 'fastify';
import type { TicketActivitySummary } from '@fleex/shared';
import { TicketNotFoundError } from '../../domain/errors.js';
import type { Container } from '../container.js';

export function agentActivityRoutes(container: Container) {
  return async function (app: FastifyInstance) {

    // Per-ticket structured activity log
    app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
      '/tickets/:id/activity',
      async (request) => {
        const ticket = await container.ticketStore.getTicketById(request.params.id);
        if (!ticket) throw new TicketNotFoundError(request.params.id);

        const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10) || 50, 1), 200);
        const activities = await container.ticketStore.getActivitiesByTicket(ticket.id, limit);
        return activities.map((a) => a.toDTO());
      },
    );

    // Raw domain events search with date range filtering
    app.get<{
      Querystring: {
        since?: string;
        until?: string;
        event_type?: string;
        limit?: string;
        before?: string;
      };
    }>('/activity', async (request) => {
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '50', 10) || 50, 1), 200);
      const since = request.query.since ? new Date(request.query.since) : undefined;
      const until = request.query.until ? new Date(request.query.until) : undefined;

      const entries = await container.domainEventLogStore.list({
        limit,
        before: request.query.before,
        eventType: request.query.event_type,
        since,
        until,
      });

      return entries.map((e) => e.toDTO());
    });

    // Distinct tickets with activity in a date range
    app.get<{
      Querystring: {
        since?: string;
        until?: string;
        event_type?: string;
        limit?: string;
      };
    }>('/activity/tickets', async (request) => {
      const limit = Math.min(Math.max(parseInt(request.query.limit ?? '200', 10) || 200, 1), 1000);
      const since = request.query.since ? new Date(request.query.since) : undefined;
      const until = request.query.until ? new Date(request.query.until) : undefined;

      const activities = await container.ticketStore.searchTicketsByActivityFilters({
        since,
        until,
        action: request.query.event_type,
        limit,
      });

      // Group by ticketId
      const ticketMap = new Map<string, { count: number; lastAt: string; eventTypes: Set<string> }>();
      for (const activity of activities) {
        const existing = ticketMap.get(activity.ticketId);
        const createdAt = activity.createdAt.toISOString();
        if (existing) {
          existing.count++;
          if (createdAt > existing.lastAt) existing.lastAt = createdAt;
          existing.eventTypes.add(activity.action);
        } else {
          ticketMap.set(activity.ticketId, {
            count: 1,
            lastAt: createdAt,
            eventTypes: new Set([activity.action]),
          });
        }
      }

      // Enrich with ticket metadata, skip deleted tickets
      const results: TicketActivitySummary[] = [];
      for (const [ticketId, info] of ticketMap) {
        const ticket = await container.ticketStore.getTicketById(ticketId);
        if (!ticket) continue;

        results.push({
          ticketId: ticket.id,
          displayId: ticket.displayId,
          title: ticket.title,
          status: ticket.status,
          boardId: ticket.boardId,
          activityCount: info.count,
          lastActivityAt: info.lastAt,
          eventTypes: [...info.eventTypes],
        });
      }

      // Sort by lastActivityAt DESC
      results.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));

      return results;
    });
  };
}

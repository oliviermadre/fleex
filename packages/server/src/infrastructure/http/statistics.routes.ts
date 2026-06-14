import type { FastifyInstance } from 'fastify';
import type { Container } from '../container.js';
import { GetStatisticsUseCase } from '../../application/use-cases/get-statistics.js';

export function statisticsRoutes(container: Container) {
  const getStatistics = new GetStatisticsUseCase(
    container.ticketStore,
    container.commentStore,
    container.mentionStore,
    container.deliverableStore,
    container.agentEventStore,
    container.personaStore,
    container.sessionStore,
    container.skillStore,
    container.domainEventLogStore,
    container.workflowRunStore,
  );

  return async function (app: FastifyInstance) {
    app.get<{
      Querystring: {
        from?: string;
        to?: string;
        granularity?: string;
        tz?: string;
      };
    }>('/api/statistics', async (request) => {
      const now = new Date();
      const from = request.query.from ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const to = request.query.to ?? now.toISOString();
      const granularity = (['day', 'week', 'month'] as const).includes(
        request.query.granularity as 'day' | 'week' | 'month',
      )
        ? (request.query.granularity as 'day' | 'week' | 'month')
        : 'day';
      // Client's Date.getTimezoneOffset() (minutes). Used to bucket the activity
      // heatmap by the user's local weekday/hour instead of the server's TZ.
      const parsedTz = Number(request.query.tz);
      const tzOffsetMinutes = Number.isFinite(parsedTz) ? parsedTz : 0;

      return getStatistics.execute({ from, to, granularity, tzOffsetMinutes });
    });
  };
}

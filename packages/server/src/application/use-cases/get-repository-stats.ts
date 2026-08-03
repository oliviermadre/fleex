import type { RepositoryStats, RepoDailyCost } from '@fleex/shared';

import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

const DAY_MS = 86_400_000;

type TicketsPort = Pick<TicketStorePort, 'getTicketsLinkedTo'>;
type ExecutionsPort = Pick<AgentEventStorePort, 'getExecutionsByTicket'>;

export class GetRepositoryStatsUseCase {
  constructor(
    private readonly ticketStore: TicketsPort,
    private readonly agentEventStore: ExecutionsPort,
  ) {}

  async execute(org: string, name: string, days = 30, now = new Date()): Promise<RepositoryStats> {
    const ref = `${org}/${name}`;
    const refs = [...new Set([ref, ref.toLowerCase()])];
    const ticketLists = await Promise.all(
      refs.map((r) => this.ticketStore.getTicketsLinkedTo('repository', r)),
    );
    const tickets = [...new Map(ticketLists.flat().map((t) => [t.id, t])).values()];

    const startOfUtcDay = (ms: number) =>
      new Date(new Date(ms).toISOString().slice(0, 10)).getTime();

    const windowStartDay = startOfUtcDay(now.getTime() - (days - 1) * DAY_MS);
    const windowEnd = now.getTime();
    const prevStart = windowStartDay - days * DAY_MS;

    const dailyCosts: RepoDailyCost[] = Array.from({ length: days }, (_, i) => ({
      date: new Date(windowStartDay + i * DAY_MS).toISOString().slice(0, 10),
      costUsd: 0,
    }));
    const buckets = new Map(dailyCosts.map((d, i) => [d.date, i]));

    let totalCostUsd = 0;
    let previousTotalCostUsd = 0;
    const ticketsWithCost = new Set<string>();

    for (const ticket of tickets) {
      const executions = await this.agentEventStore.getExecutionsByTicket(ticket.id);
      for (const execution of executions) {
        const cost = execution.costUsd ?? 0;
        if (cost <= 0) continue;
        const ts = new Date(execution.startedAt).getTime();
        if (ts >= windowStartDay && ts <= windowEnd) {
          totalCostUsd += cost;
          ticketsWithCost.add(ticket.id);
          const idx = buckets.get(new Date(ts).toISOString().slice(0, 10));
          if (idx !== undefined) {
            dailyCosts[idx] = { ...dailyCosts[idx]!, costUsd: dailyCosts[idx]!.costUsd + cost };
          }
        } else if (ts >= prevStart && ts < windowStartDay) {
          previousTotalCostUsd += cost;
        }
      }
    }

    return {
      totalCostUsd,
      previousTotalCostUsd,
      costPerTicketUsd: ticketsWithCost.size > 0 ? totalCostUsd / ticketsWithCost.size : 0,
      ticketsWithCostCount: ticketsWithCost.size,
      days,
      dailyCosts,
    };
  }
}

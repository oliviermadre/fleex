import type { AgentExecution, TicketUsage, TicketUsageBreakdown } from '@fleex/shared';

function emptyBreakdown(): {
  executionCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
} {
  return {
    executionCount: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0,
  };
}

function add(acc: ReturnType<typeof emptyBreakdown>, e: AgentExecution): void {
  acc.executionCount += 1;
  acc.inputTokens += e.inputTokens ?? 0;
  acc.outputTokens += e.outputTokens ?? 0;
  acc.cacheReadTokens += e.cacheReadTokens ?? 0;
  acc.cacheCreationTokens += e.cacheCreationTokens ?? 0;
  acc.costUsd += e.costUsd ?? 0;
}

/**
 * Roll up a ticket's executions into auto (agent/skill/panel/workflow) vs manual
 * token usage. Pure so it can be unit-tested and reused regardless of transport.
 */
export function aggregateTicketUsage(ticketId: string, executions: AgentExecution[]): TicketUsage {
  const auto = emptyBreakdown();
  const manual = emptyBreakdown();

  for (const e of executions) {
    if ((e.source ?? 'agent') === 'manual') add(manual, e);
    else add(auto, e);
  }

  const total: TicketUsageBreakdown = {
    executionCount: auto.executionCount + manual.executionCount,
    inputTokens: auto.inputTokens + manual.inputTokens,
    outputTokens: auto.outputTokens + manual.outputTokens,
    cacheReadTokens: auto.cacheReadTokens + manual.cacheReadTokens,
    cacheCreationTokens: auto.cacheCreationTokens + manual.cacheCreationTokens,
    costUsd: auto.costUsd + manual.costUsd,
  };

  return { ticketId, auto, manual, total };
}

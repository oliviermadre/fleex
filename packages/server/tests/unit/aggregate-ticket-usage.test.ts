import { describe, it, expect } from 'vitest';
import { aggregateTicketUsage } from '../../src/application/utils/aggregate-ticket-usage.js';
import type { AgentExecution } from '@fleex/shared';

function exec(partial: Partial<AgentExecution>): AgentExecution {
  return {
    id: partial.id ?? 'e',
    personaId: partial.personaId ?? 'p',
    ticketId: 'tk-1',
    mentionId: partial.mentionId ?? 'm',
    eventCount: 0,
    status: partial.status ?? 'completed',
    startedAt: '2026-05-29T10:00:00Z',
    completedAt: '2026-05-29T10:01:00Z',
    lastEventAt: null,
    inputTokens: partial.inputTokens ?? null,
    outputTokens: partial.outputTokens ?? null,
    cacheReadTokens: partial.cacheReadTokens ?? null,
    cacheCreationTokens: partial.cacheCreationTokens ?? null,
    costUsd: partial.costUsd ?? null,
    source: partial.source ?? 'agent',
  };
}

describe('aggregateTicketUsage', () => {
  it('splits auto vs manual and totals tokens + cost', () => {
    const usage = aggregateTicketUsage('tk-1', [
      exec({ source: 'agent', inputTokens: 100, outputTokens: 40, cacheReadTokens: 10, cacheCreationTokens: 5, costUsd: 0.5 }),
      exec({ source: 'skill', inputTokens: 50, outputTokens: 20, costUsd: 0.25 }),
      exec({ source: 'manual', inputTokens: 300, outputTokens: 60, cacheReadTokens: 80 }),
    ]);

    expect(usage.ticketId).toBe('tk-1');

    expect(usage.auto).toEqual({
      executionCount: 2,
      inputTokens: 150,
      outputTokens: 60,
      cacheReadTokens: 10,
      cacheCreationTokens: 5,
      costUsd: 0.75,
    });

    expect(usage.manual).toEqual({
      executionCount: 1,
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 80,
      cacheCreationTokens: 0,
      costUsd: 0,
    });

    expect(usage.total.inputTokens).toBe(450);
    expect(usage.total.outputTokens).toBe(120);
    expect(usage.total.cacheReadTokens).toBe(90);
    expect(usage.total.executionCount).toBe(3);
    expect(usage.total.costUsd).toBe(0.75);
  });

  it('treats a missing source as auto', () => {
    const e = exec({ inputTokens: 10 });
    const usage = aggregateTicketUsage('tk-1', [{ ...e, source: undefined }]);
    expect(usage.auto.executionCount).toBe(1);
    expect(usage.manual.executionCount).toBe(0);
  });

  it('returns zeroed breakdowns for no executions', () => {
    const usage = aggregateTicketUsage('tk-1', []);
    expect(usage.total.executionCount).toBe(0);
    expect(usage.auto.inputTokens).toBe(0);
    expect(usage.manual.inputTokens).toBe(0);
  });
});

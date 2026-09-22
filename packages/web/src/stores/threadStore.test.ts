import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AgentThread } from '@fleex/shared';

vi.mock('../services/api', () => ({ fetchTicketThreads: vi.fn(), fetchOpenThreads: vi.fn() }));

import { useThreadStore, upsertThread, selectOpenByTicket } from './threadStore';

function thread(over: Partial<AgentThread> & { id: string }): AgentThread {
  return {
    ticketId: 't1', initiator: 'assistant', personaId: 'p', personaName: 'builder', assistantPersonaId: 'a',
    brief: 'b', forwardedContext: [], status: 'running', currentMentionId: null, exchanges: 0, failures: 0, summary: null,
    createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', concludedAt: null,
    ...over,
  };
}

describe('threadStore', () => {
  beforeEach(() => useThreadStore.setState({ threadsByTicket: {} }));

  it('upsertThread replaces by id and keeps newest first', () => {
    const a = thread({ id: 'a', createdAt: '2026-09-21T10:00:00.000Z' });
    const b = thread({ id: 'b', createdAt: '2026-09-21T11:00:00.000Z' });
    const list = upsertThread(upsertThread([], a), b);
    expect(list.map((t) => t.id)).toEqual(['b', 'a']);
    const a2 = { ...a, status: 'concluded' as const };
    expect(upsertThread(list, a2).map((t) => [t.id, t.status])).toEqual([['b', 'running'], ['a', 'concluded']]);
  });

  it('applyWsMessage upserts thread:* payloads and ignores other types', () => {
    const s = useThreadStore.getState();
    s.applyWsMessage({ type: 'thread:created', data: thread({ id: 'x' }) });
    s.applyWsMessage({ type: 'comment:created', data: { id: 'nope' } });
    expect(useThreadStore.getState().threadsByTicket['t1']?.map((t) => t.id)).toEqual(['x']);
    s.applyWsMessage({ type: 'thread:concluded', data: thread({ id: 'x', status: 'concluded' }) });
    expect(useThreadStore.getState().threadsByTicket['t1']?.[0]?.status).toBe('concluded');
  });

  it('selectOpenByTicket excludes terminal threads', () => {
    useThreadStore.setState({
      threadsByTicket: { t1: [thread({ id: 'a' }), thread({ id: 'b', status: 'waiting' }), thread({ id: 'c', status: 'failed' }), thread({ id: 'd', status: 'concluded' })] },
    });
    expect(selectOpenByTicket(useThreadStore.getState(), 't1').map((t) => t.id)).toEqual(['a', 'b']);
    expect(selectOpenByTicket(useThreadStore.getState(), 't2')).toEqual([]);
  });
});

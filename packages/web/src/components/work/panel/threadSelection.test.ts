import { describe, it, expect } from 'vitest';
import type { AgentThread } from '@fleex/shared';
import { resolveSelectedThread } from './threadSelection';

function thread(id: string, status: AgentThread['status'] = 'running'): AgentThread {
  return {
    id, ticketId: 't1', initiator: 'assistant', personaId: 'p', personaName: 'b', assistantPersonaId: 'a', brief: 'x',
    forwardedContext: [], status, currentMentionId: null, exchanges: 0, failures: 0, summary: null,
    createdAt: '2026-09-21T10:00:00.000Z', updatedAt: '2026-09-21T10:00:00.000Z', concludedAt: null,
  };
}

describe('resolveSelectedThread', () => {
  it('returns null without threads', () => {
    expect(resolveSelectedThread([], 'x')).toBeNull();
  });
  it('keeps the persisted selection when it exists', () => {
    expect(resolveSelectedThread([thread('a'), thread('b')], 'b')?.id).toBe('b');
  });
  it('falls back to the most recent open thread', () => {
    expect(resolveSelectedThread([thread('a', 'concluded'), thread('b', 'waiting'), thread('c')], 'gone')?.id).toBe('b');
  });
  it('falls back to the most recent thread when none is open', () => {
    expect(resolveSelectedThread([thread('a', 'concluded'), thread('b', 'failed')], null)?.id).toBe('a');
  });
});


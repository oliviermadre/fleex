import { describe, it, expect } from 'vitest';
import { liveTextOf } from './AssistantLiveReply';

describe('liveTextOf', () => {
  it('concatenates only the assistant text deltas', () => {
    const d = (type: string, content: unknown[]) => ({ eventType: 'content_block_delta', data: { type, message: { content } } });
    expect(liveTextOf([
      { eventType: 'execution_start', data: {} },
      d('assistant', [{ type: 'text', text: 'Bon' }]),
      d('assistant', [{ type: 'tool_use', name: 'fleex_ticket_show', input: {} }]),
      d('user', [{ type: 'tool_result', content: 'nope' }]),
      d('assistant', [{ type: 'text', text: 'jour' }]),
    ])).toBe('Bonjour');
    expect(liveTextOf([])).toBe('');
  });
});

describe('liveTextOf — ordering', () => {
  it('sorts by sequence and drops duplicate ids', () => {
    const d = (id: string, sequence: number, text: string) => ({ id, sequence, eventType: 'content_block_delta', data: { type: 'assistant', message: { content: [{ type: 'text', text }] } } });
    expect(liveTextOf([d('c', 3, 'jour'), d('a', 1, 'Bon'), d('b', 2, ''), d('a', 1, 'Bon')])).toBe('Bonjour');
  });
});

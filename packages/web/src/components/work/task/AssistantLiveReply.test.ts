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

import { describe, it, expect } from 'vitest';
import { parseTranscriptUsage, extractTranscriptText } from '../../src/application/utils/parse-transcript-usage.js';

const line = (obj: unknown) => JSON.stringify(obj);

describe('parseTranscriptUsage', () => {
  it('sums usage across all assistant turns (including sidechains)', () => {
    const jsonl = [
      line({ type: 'user', message: { role: 'user', content: 'hello' }, timestamp: '2026-05-29T10:00:00Z' }),
      line({
        type: 'assistant',
        timestamp: '2026-05-29T10:00:05Z',
        message: {
          role: 'assistant',
          model: 'claude-opus-4-8',
          usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 },
        },
      }),
      // sidechain (sub-agent) turn on a cheaper model
      line({
        type: 'assistant',
        isSidechain: true,
        timestamp: '2026-05-29T10:00:09Z',
        message: {
          role: 'assistant',
          model: 'claude-haiku-4-5',
          usage: { input_tokens: 200, output_tokens: 20 },
        },
      }),
    ].join('\n');

    const usage = parseTranscriptUsage(jsonl);

    expect(usage.inputTokens).toBe(300);
    expect(usage.outputTokens).toBe(70);
    expect(usage.cacheReadTokens).toBe(10);
    expect(usage.cacheCreationTokens).toBe(5);
    expect(usage.assistantTurns).toBe(2);
    // dominant model = most output tokens = opus (50 > 20)
    expect(usage.model).toBe('claude-opus-4-8');
    expect(usage.firstTimestamp).toBe('2026-05-29T10:00:00Z');
    expect(usage.lastTimestamp).toBe('2026-05-29T10:00:09Z');
  });

  it('tolerates blank and corrupt lines', () => {
    const jsonl = [
      '',
      '{not json',
      line({ type: 'assistant', message: { role: 'assistant', usage: { input_tokens: 1, output_tokens: 2 } } }),
      '   ',
    ].join('\n');

    const usage = parseTranscriptUsage(jsonl);
    expect(usage.assistantTurns).toBe(1);
    expect(usage.outputTokens).toBe(2);
  });

  it('returns zeroed usage for an empty transcript', () => {
    const usage = parseTranscriptUsage('');
    expect(usage.assistantTurns).toBe(0);
    expect(usage.inputTokens).toBe(0);
    expect(usage.model).toBeNull();
  });

  it('ignores user turns and turns without usage', () => {
    const jsonl = [
      line({ type: 'user', message: { role: 'user', content: 'hi' } }),
      line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'no usage here' }] } }),
    ].join('\n');
    const usage = parseTranscriptUsage(jsonl);
    expect(usage.assistantTurns).toBe(0);
  });
});

describe('extractTranscriptText', () => {
  it('extracts user and assistant text, dropping tool noise', () => {
    const jsonl = [
      line({ type: 'user', message: { role: 'user', content: 'Fix the bug' } }),
      line({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will fix it.' },
            { type: 'tool_use', name: 'Edit', input: {} },
          ],
        },
      }),
    ].join('\n');

    const text = extractTranscriptText(jsonl);
    expect(text).toContain('User: Fix the bug');
    expect(text).toContain('Assistant: I will fix it.');
    expect(text).not.toContain('tool_use');
  });

  it('keeps the tail when exceeding maxChars', () => {
    const jsonl = [
      line({ type: 'assistant', message: { role: 'assistant', content: 'AAAA' } }),
      line({ type: 'assistant', message: { role: 'assistant', content: 'ZZZZ' } }),
    ].join('\n');
    const text = extractTranscriptText(jsonl, 12);
    expect(text.length).toBeLessThanOrEqual(12);
    expect(text).toContain('ZZZZ');
  });
});

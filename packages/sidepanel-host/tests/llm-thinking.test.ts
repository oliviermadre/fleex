import { describe, it, expect } from 'vitest';

import { createLlm } from '../src/anthropic.ts';

// A fake Anthropic client that captures the params handed to messages.stream
// and returns a minimal stream, so we can assert how `thinking` is set per model.
function fakeClient() {
  const calls: Record<string, unknown>[] = [];
  const client = {
    messages: {
      stream(params: Record<string, unknown>) {
        calls.push(params);
        return {
          on() {},
          async finalMessage() {
            return { content: [], stop_reason: 'end_turn' };
          },
        };
      },
    },
  };
  return { client, calls };
}

async function paramsFor(model: string): Promise<Record<string, unknown>> {
  const { client, calls } = fakeClient();
  const llm = createLlm(client as never, model);
  await llm({ system: 's', messages: [], tools: [] }, () => {});
  return calls[0]!;
}

describe('createLlm — adaptive thinking gating', () => {
  it('sends adaptive thinking for models that support effort (Opus/Sonnet)', async () => {
    expect((await paramsFor('claude-opus-5')).thinking).toEqual({ type: 'adaptive' });
    expect((await paramsFor('claude-opus-4-8')).thinking).toEqual({ type: 'adaptive' });
    expect((await paramsFor('claude-sonnet-4-6')).thinking).toEqual({ type: 'adaptive' });
  });

  it('omits thinking for Haiku (would 400 with "adaptive thinking is not supported")', async () => {
    const params = await paramsFor('claude-haiku-4-5');
    expect(params.thinking).toBeUndefined();
    expect('thinking' in params).toBe(false);
    expect(params.model).toBe('claude-haiku-4-5');
  });
});

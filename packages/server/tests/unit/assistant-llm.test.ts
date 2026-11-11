import { describe, it, expect } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import {
  ASSISTANT_FALLBACK_OUTPUT_TOKENS, ASSISTANT_MAX_OUTPUT_TOKENS, UNKNOWN_MODEL_PROFILE,
  buildAssistantRequest, createAnthropicAssistantLlm, type AssistantModelProfile,
} from '../../src/application/assistant/assistant-llm.js';

const tools = [{ name: 'delegate', description: 'd', input_schema: { type: 'object' as const, properties: {} } }] as Anthropic.Tool[];
const adaptive: AssistantModelProfile = { adaptiveThinking: true, maxOutputTokens: 128_000 };
const budgetOnly: AssistantModelProfile = { adaptiveThinking: false, maxOutputTokens: 64_000 };

/** The conversation as the use case holds it at the second round: prompt, the model's answer (thinking included), tool results. */
function secondRound(): Anthropic.MessageParam[] {
  return [
    { role: 'user', content: 'PROMPT' },
    { role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'tu-1', name: 'delegate', input: {} },
      { type: 'tool_use', id: 'tu-2', name: 'delegate', input: {} },
    ] },
    { role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'tu-1', content: 'ok' },
      { type: 'tool_result', tool_use_id: 'tu-2', content: 'ok' },
    ] },
  ];
}
const marked = (blocks: unknown) => (blocks as Array<{ cache_control?: unknown }>).map((b) => b.cache_control !== undefined);

describe('buildAssistantRequest — prompt caching', () => {
  it('first round: one breakpoint on the system prompt (it covers the tools, rendered before it) and one on the user prompt', () => {
    const req = buildAssistantRequest({ model: 'm', system: 'SYSTEM', tools, messages: [{ role: 'user', content: 'PROMPT' }] }, adaptive);
    expect(req.system).toEqual([{ type: 'text', text: 'SYSTEM', cache_control: { type: 'ephemeral' } }]);
    expect(req.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'PROMPT', cache_control: { type: 'ephemeral' } }] }]);
    expect(req.tools).toBe(tools);
  });

  // What makes the second round READ the cache: the prefix the first round
  // wrote (tools + system + prompt) is sent byte-identical, and the breakpoint
  // has moved to the end of what was appended.
  it('second round: the prefix is unchanged and the tail breakpoint has moved to the last tool result — two breakpoints, never more', () => {
    const messages = secondRound();
    const first = buildAssistantRequest({ model: 'm', system: 'SYSTEM', tools, messages: messages.slice(0, 1) }, adaptive);
    const second = buildAssistantRequest({ model: 'm', system: 'SYSTEM', tools, messages }, adaptive);
    expect(second.system).toEqual(first.system);
    expect(second.tools).toBe(first.tools);
    // The prompt is back to its plain form: same bytes as what was cached, no stale marker.
    expect(second.messages[0]).toEqual({ role: 'user', content: 'PROMPT' });
    expect(marked(second.messages[2]!.content)).toEqual([false, true]);
    const all = JSON.stringify(second).match(/"cache_control"/g) ?? [];
    expect(all).toHaveLength(2);
  });

  it('the conversation held by the caller is never mutated, and thinking blocks go back untouched', () => {
    const messages = secondRound();
    const before = JSON.stringify(messages);
    const req = buildAssistantRequest({ model: 'm', system: 'S', tools, messages, thinking: true }, adaptive);
    expect(JSON.stringify(messages)).toBe(before);
    expect(req.messages[1]).toBe(messages[1]);
    expect((req.messages[1]!.content as Anthropic.ContentBlockParam[])[0]).toEqual({ type: 'thinking', thinking: '', signature: 'sig-1' });
  });
});

describe('buildAssistantRequest — thinking and output cap, per model', () => {
  const base = { model: 'm', system: 'S', tools, messages: [{ role: 'user' as const, content: 'P' }] };

  it('a decision turn asks for adaptive thinking where the model advertises it', () => {
    expect(buildAssistantRequest({ ...base, thinking: true }, adaptive).thinking).toEqual({ type: 'adaptive' });
  });

  it('any other turn sends no thinking parameter at all — never `disabled`, which several models reject', () => {
    for (const thinking of [false, undefined]) {
      expect('thinking' in buildAssistantRequest({ ...base, thinking }, adaptive)).toBe(false);
    }
  });

  it('a model without adaptive thinking, or an unknown one, degrades to no thinking — never a token budget', () => {
    for (const profile of [budgetOnly, UNKNOWN_MODEL_PROFILE]) {
      const req = buildAssistantRequest({ ...base, thinking: true }, profile);
      expect('thinking' in req).toBe(false);
      expect(JSON.stringify(req)).not.toContain('budget_tokens');
    }
  });

  it('never sends what current models reject: sampling parameters, forced tool choice, effort', () => {
    const req = buildAssistantRequest({ ...base, thinking: true }, adaptive) as unknown as Record<string, unknown>;
    for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice', 'output_config']) expect(k in req).toBe(false);
  });

  it('the output cap is raised well above 4096, and never above what the model accepts', () => {
    expect(ASSISTANT_MAX_OUTPUT_TOKENS).toBeGreaterThanOrEqual(16_000);
    expect(buildAssistantRequest(base, adaptive).max_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS);
    expect(buildAssistantRequest(base, { adaptiveThinking: false, maxOutputTokens: 8192 }).max_tokens).toBe(8192);
    expect(buildAssistantRequest(base, UNKNOWN_MODEL_PROFILE).max_tokens).toBe(ASSISTANT_FALLBACK_OUTPUT_TOKENS);
  });
});

describe('createAnthropicAssistantLlm', () => {
  function fakeClient(retrieve: (id: string) => Promise<unknown>) {
    const requests: Anthropic.MessageStreamParams[] = [];
    const lookups: string[] = [];
    const client = {
      models: { retrieve: async (id: string) => { lookups.push(id); return retrieve(id); } },
      messages: {
        stream: (req: Anthropic.MessageStreamParams) => {
          requests.push(req);
          return {
            on(_e: string, cb: (d: string) => void) { cb('salut'); },
            finalMessage: async () => ({
              content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'salut', citations: null }],
              stop_reason: 'end_turn',
              usage: { input_tokens: 12, output_tokens: 3, cache_read_input_tokens: 4321, cache_creation_input_tokens: 77 },
            }),
          };
        },
      },
    };
    return { client: client as unknown as Anthropic, requests, lookups };
  }
  const capable = async () => ({ max_tokens: 128_000, capabilities: { thinking: { supported: true, types: { adaptive: { supported: true }, enabled: { supported: false } } } } });
  const params = { model: 'claude-x', system: 'S', tools, messages: [{ role: 'user' as const, content: 'P' }], thinking: true };

  it("asks the Models API what the persona's model accepts, once per model, and builds the request from it", async () => {
    const { client, requests, lookups } = fakeClient(capable);
    const llm = createAnthropicAssistantLlm(client);
    const said: string[] = [];
    const res = await llm(params, (d) => said.push(d));
    await llm(params, () => {});
    expect(lookups).toEqual(['claude-x']);
    expect(requests[0]).toMatchObject({ model: 'claude-x', max_tokens: ASSISTANT_MAX_OUTPUT_TOKENS, thinking: { type: 'adaptive' } });
    expect(said).toEqual(['salut']);
    // The whole content comes back, thinking block included, for the next round.
    expect(res.content.map((b) => b.type)).toEqual(['thinking', 'text']);
    expect(res.stopReason).toBe('end_turn');
  });

  it('reports the cache tokens of the response, so the turn cost counts them', async () => {
    const { client } = fakeClient(capable);
    const res = await createAnthropicAssistantLlm(client)(params, () => {});
    expect(res.usage).toEqual({ inputTokens: 12, outputTokens: 3, cacheReadTokens: 4321, cacheCreationTokens: 77 });
  });

  it('a model that only takes a thinking budget (or reports no capabilities) runs without thinking', async () => {
    for (const info of [
      { max_tokens: 64_000, capabilities: { thinking: { supported: true, types: { adaptive: { supported: false }, enabled: { supported: true } } } } },
      { max_tokens: 64_000, capabilities: null },
    ]) {
      const { client, requests } = fakeClient(async () => info);
      await createAnthropicAssistantLlm(client)(params, () => {});
      expect('thinking' in requests[0]!).toBe(false);
      expect(requests[0]!.max_tokens).toBe(ASSISTANT_MAX_OUTPUT_TOKENS);
    }
  });

  it('when the lookup fails the turn still runs, on the safe profile, and the next turn asks again', async () => {
    let fail = true;
    const { client, requests, lookups } = fakeClient(async () => { if (fail) throw new Error('503'); return capable(); });
    const llm = createAnthropicAssistantLlm(client);
    await llm(params, () => {});
    expect('thinking' in requests[0]!).toBe(false);
    expect(requests[0]!.max_tokens).toBe(ASSISTANT_FALLBACK_OUTPUT_TOKENS);
    fail = false;
    await llm(params, () => {});
    expect(lookups).toHaveLength(2);
    expect(requests[1]!.thinking).toEqual({ type: 'adaptive' });
  });
});

import { describe, it, expect, vi } from 'vitest';
import type { GeneratedTool } from '@fleex/mcp';
import type Anthropic from '@anthropic-ai/sdk';
import { runAssistant, type AssistantEvent, type LlmComplete } from '../src/assistant.ts';
import { toAnthropicTools } from '../src/tools.ts';

const tools: GeneratedTool[] = [
  {
    name: 'fleex_ticket_list',
    commandPath: ['ticket', 'list'],
    description: 'List tickets',
    inputSchema: { type: 'object', properties: { status: { type: 'string' } }, required: [], additionalProperties: false },
    mutating: false,
    workspaceAware: true,
    arguments: [],
    options: [{ key: 'status', flag: '--status', takesValue: true, variadic: false }],
  },
  {
    name: 'fleex_ticket_create',
    commandPath: ['ticket', 'create'],
    description: 'Create a ticket',
    inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false },
    mutating: true,
    workspaceAware: true,
    arguments: [],
    options: [{ key: 'title', flag: '--title', takesValue: true, variadic: false }],
  },
  {
    name: 'fleex_ticket_delete',
    commandPath: ['ticket', 'delete'],
    description: 'Delete a ticket',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
    mutating: true,
    workspaceAware: true,
    arguments: [{ key: 'id', required: true, variadic: false }],
    options: [],
  },
];
const anthropicTools = toAnthropicTools(tools);

function textBlock(text: string): Anthropic.ContentBlock {
  return { type: 'text', text, citations: null } as unknown as Anthropic.ContentBlock;
}
function toolBlock(id: string, name: string, input: Record<string, unknown>): Anthropic.ContentBlock {
  return { type: 'tool_use', id, name, input } as unknown as Anthropic.ContentBlock;
}

/** An llm that returns a scripted sequence of responses, one per call. */
function scriptedLlm(responses: Array<{ content: Anthropic.ContentBlock[]; stopReason: string | null }>): LlmComplete {
  let i = 0;
  return async (_params, onText) => {
    const r = responses[Math.min(i, responses.length - 1)]!;
    i++;
    for (const b of r.content) if (b.type === 'text') onText(b.text);
    return r;
  };
}

function collect(): { onEvent: (e: AssistantEvent) => void; events: AssistantEvent[] } {
  const events: AssistantEvent[] = [];
  return { onEvent: (e) => events.push(e), events };
}

describe('runAssistant gating', () => {
  it('does NOT confirm a read-only tool and runs it', async () => {
    const confirm = vi.fn(async () => true);
    const exec = vi.fn(async () => ({ ok: true, text: '[]' }));
    const { onEvent, events } = collect();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_list', { status: 'doing' })], stopReason: 'tool_use' },
      { content: [textBlock('Here are the tickets.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec, confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'list doing' }], onEvent,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledOnce();
    expect(events.some((e) => e.type === 'done')).toBe(true);
  });

  it('confirms and runs a mutating tool when approved', async () => {
    const confirm = vi.fn(async () => true);
    const exec = vi.fn(async () => ({ ok: true, text: '{"displayId":1}' }));
    const { onEvent, events } = collect();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_create', { title: 'X' })], stopReason: 'tool_use' },
      { content: [textBlock('Created.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec, confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'create X' }], onEvent,
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenCalledOnce();
    const call = events.find((e) => e.type === 'tool_call');
    expect(call && call.type === 'tool_call' && call.mutating).toBe(true);
    expect(call && call.type === 'tool_call' && call.argv).toEqual(['ticket', 'create', '--title', 'X', '--json']);
  });

  it('does NOT execute a mutating tool when the user declines', async () => {
    const confirm = vi.fn(async () => false);
    const exec = vi.fn(async () => ({ ok: true, text: 'should not run' }));
    const { onEvent, events } = collect();
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'create X' }];
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_create', { title: 'X' })], stopReason: 'tool_use' },
      { content: [textBlock('Okay, I will not create it.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({ llm, exec, confirm, tools, anthropicTools, system: 's', messages, onEvent });

    expect(confirm).toHaveBeenCalledOnce();
    expect(exec).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'tool_denied')).toBe(true);
    // The denial is fed back to the model as an error tool_result.
    const toolResultTurn = messages.find(
      (m) => m.role === 'user' && Array.isArray(m.content) && m.content.some((b) => (b as { type: string }).type === 'tool_result'),
    );
    expect(toolResultTurn).toBeDefined();
  });

  it('streams text deltas as text events', async () => {
    const { onEvent, events } = collect();
    const llm = scriptedLlm([{ content: [textBlock('hello world')], stopReason: 'end_turn' }]);
    await runAssistant({
      llm, exec: vi.fn(), confirm: vi.fn(), tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'hi' }], onEvent,
    });
    expect(events.find((e) => e.type === 'text')).toEqual({ type: 'text', text: 'hello world' });
  });

  it('reports an unknown tool as an error without executing', async () => {
    const exec = vi.fn();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_bogus', {})], stopReason: 'tool_use' },
      { content: [textBlock('done')], stopReason: 'end_turn' },
    ]);
    const { onEvent, events } = collect();
    await runAssistant({
      llm, exec, confirm: vi.fn(async () => true), tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'x' }], onEvent,
    });
    expect(exec).not.toHaveBeenCalled();
    const r = events.find((e) => e.type === 'tool_result');
    expect(r && r.type === 'tool_result' && r.ok).toBe(false);
  });

  it('reports autoApproved:false on a gated call when no allowlist is wired', async () => {
    const confirm = vi.fn(async () => true);
    const { onEvent, events } = collect();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_create', { title: 'X' })], stopReason: 'tool_use' },
      { content: [textBlock('Created.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec: vi.fn(async () => ({ ok: true, text: 'ok' })), confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'create X' }], onEvent,
    });

    expect(confirm).toHaveBeenCalledOnce();
    const call = events.find((e) => e.type === 'tool_call');
    expect(call && call.type === 'tool_call' && call.autoApproved).toBe(false);
  });

  it('stops at the iteration cap', async () => {
    // Always asks for a (read-only) tool — never terminates on its own.
    const llm: LlmComplete = async () => ({
      content: [toolBlock('t', 'fleex_ticket_list', {})], stopReason: 'tool_use',
    });
    const { onEvent, events } = collect();
    await runAssistant({
      llm, exec: vi.fn(async () => ({ ok: true, text: '[]' })), confirm: vi.fn(),
      tools, anthropicTools, system: 's', messages: [{ role: 'user', content: 'loop' }], onEvent,
      maxIterations: 3,
    });
    const done = events.find((e) => e.type === 'done');
    expect(done && done.type === 'done' && done.stopReason).toBe('max_iterations');
  });
});

describe('runAssistant auto-approval', () => {
  it('skips the confirmation for a tool the conversation already allowed', async () => {
    const confirm = vi.fn(async () => true);
    const exec = vi.fn(async () => ({ ok: true, text: '{"displayId":1}' }));
    const { onEvent, events } = collect();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_create', { title: 'X' })], stopReason: 'tool_use' },
      { content: [textBlock('Created.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec, confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'create X' }], onEvent,
      isAutoApproved: (n) => n === 'fleex_ticket_create',
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledOnce();
    const call = events.find((e) => e.type === 'tool_call');
    expect(call && call.type === 'tool_call' && call.autoApproved).toBe(true);
  });

  it('still confirms a mutating tool that is NOT on the allowlist', async () => {
    // Allowlisting `ticket create` must not silently extend to `ticket delete`:
    // the blast radius stays bounded to what the user actually approved once.
    const confirm = vi.fn(async () => true);
    const exec = vi.fn(async () => ({ ok: true, text: 'deleted' }));
    const { onEvent } = collect();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_delete', { id: '7' })], stopReason: 'tool_use' },
      { content: [textBlock('Deleted.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec, confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'delete 7' }], onEvent,
      isAutoApproved: (n) => n === 'fleex_ticket_create',
    });

    expect(confirm).toHaveBeenCalledOnce();
  });

  it('skips every confirmation when the conversation auto-approves all tools', async () => {
    const confirm = vi.fn(async () => true);
    const exec = vi.fn(async () => ({ ok: true, text: 'ok' }));
    const { onEvent } = collect();
    const llm = scriptedLlm([
      {
        content: [
          toolBlock('t1', 'fleex_ticket_create', { title: 'A' }),
          toolBlock('t2', 'fleex_ticket_delete', { id: '9' }),
        ],
        stopReason: 'tool_use',
      },
      { content: [textBlock('Done.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec, confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'go' }], onEvent,
      isAutoApproved: () => true,
    });

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('covers the REST of the same turn once the user answers "always" on the first call', async () => {
    // The point of the feature: one click on call #1 must clear #2 and #3
    // without another round-trip. This only works if `isAutoApproved` reads
    // live state instead of a value captured when the turn started.
    const allowed = new Set<string>();
    const confirm = vi.fn(async (req: { name: string }) => {
      allowed.add(req.name); // what the server does on `confirm { always: 'tool' }`
      return true;
    });
    const exec = vi.fn(async () => ({ ok: true, text: 'ok' }));
    const { onEvent, events } = collect();
    const llm = scriptedLlm([
      {
        content: [
          toolBlock('t1', 'fleex_ticket_create', { title: 'A' }),
          toolBlock('t2', 'fleex_ticket_create', { title: 'B' }),
          toolBlock('t3', 'fleex_ticket_create', { title: 'C' }),
        ],
        stopReason: 'tool_use',
      },
      { content: [textBlock('Created 3.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec, confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'create 3' }], onEvent,
      isAutoApproved: (n) => allowed.has(n),
    });

    expect(confirm).toHaveBeenCalledOnce();
    expect(exec).toHaveBeenCalledTimes(3);
    const flags = events.filter((e) => e.type === 'tool_call').map((e) => e.type === 'tool_call' && e.autoApproved);
    expect(flags).toEqual([false, true, true]);
  });

  it('never consults the allowlist for a read-only tool', async () => {
    const isAutoApproved = vi.fn(() => true);
    const confirm = vi.fn(async () => true);
    const { onEvent } = collect();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_list', {})], stopReason: 'tool_use' },
      { content: [textBlock('Here.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec: vi.fn(async () => ({ ok: true, text: '[]' })), confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'list' }], onEvent,
      isAutoApproved,
    });

    expect(isAutoApproved).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('denies normally when the allowlist does not cover the call', async () => {
    const confirm = vi.fn(async () => false);
    const exec = vi.fn();
    const { onEvent, events } = collect();
    const llm = scriptedLlm([
      { content: [toolBlock('t1', 'fleex_ticket_delete', { id: '3' })], stopReason: 'tool_use' },
      { content: [textBlock('Not deleting.')], stopReason: 'end_turn' },
    ]);

    await runAssistant({
      llm, exec, confirm, tools, anthropicTools,
      system: 's', messages: [{ role: 'user', content: 'delete 3' }], onEvent,
      isAutoApproved: () => false,
    });

    expect(exec).not.toHaveBeenCalled();
    expect(events.some((e) => e.type === 'tool_denied')).toBe(true);
  });
});

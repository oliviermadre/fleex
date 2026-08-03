/**
 * End-to-end test of the "always allow" gate.
 *
 * Every piece of this feature was unit-tested in isolation and every unit
 * passed while the feature was broken in production: nothing exercised the
 * WIRING — `runAssistant` asking, `applyConfirm` granting, `resolveAutoApproved`
 * answering. This file closes that gap by reproducing exactly the wiring
 * `server.ts` does (minus the socket), so a mismatch anywhere along the chain
 * fails here.
 *
 * The user-visible contract under test: after clicking "Toujours autoriser",
 * the same tool never asks again — same turn, later turn, new conversation, and
 * after a companion restart.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import type { GeneratedTool } from '@fleex/mcp';
import { runAssistant, type LlmComplete } from '../src/assistant.ts';
import { toAnthropicTools } from '../src/tools.ts';
import { SessionStore, type SessionData } from '../src/sessions.ts';
import { GlobalAllowlist } from '../src/global-allowlist.ts';
import { applyConfirm, disarmForPage, resolveAutoApproved, type PendingConfirm } from '../src/auto-approve.ts';

const tools: GeneratedTool[] = [
  {
    name: 'fleex_ticket_link',
    commandPath: ['ticket', 'link'],
    description: 'Link a PR to a ticket',
    inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'], additionalProperties: false },
    mutating: true,
    workspaceAware: true,
    arguments: [],
    options: [{ key: 'url', flag: '--url', takesValue: true, variadic: false }],
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
];
const anthropicTools = toAnthropicTools(tools);

function toolBlock(id: string, name: string, input: Record<string, unknown>): Anthropic.ContentBlock {
  return { type: 'tool_use', id, name, input } as unknown as Anthropic.ContentBlock;
}
function textBlock(text: string): Anthropic.ContentBlock {
  return { type: 'text', text, citations: null } as unknown as Anthropic.ContentBlock;
}

/** Emits the scripted tool calls, then ends the turn. */
function llmCalling(calls: Array<{ id: string; name: string }>): LlmComplete {
  let i = 0;
  return async () => {
    const call = calls[i++];
    return call
      ? { content: [toolBlock(call.id, call.name, { url: 'https://x', title: 'X' })], stopReason: 'tool_use' }
      : { content: [textBlock('done')], stopReason: 'end_turn' };
  };
}

let dir: string;
let store: SessionStore;
let global: GlobalAllowlist;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-gate-e2e-'));
  store = new SessionStore(path.join(dir, 'sessions'));
  global = new GlobalAllowlist(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * Run one user turn exactly as `server.ts` wires it: the confirm callback
 * registers a pending entry and answers it through `applyConfirm`, and the gate
 * is read through `resolveAutoApproved` on the LIVE session.
 */
async function runTurn(
  session: SessionData,
  calls: Array<{ id: string; name: string }>,
  answer: { approved: boolean; always?: 'tool' | 'session' } = { approved: true, always: 'tool' },
): Promise<{ confirm: ReturnType<typeof vi.fn>; exec: ReturnType<typeof vi.fn> }> {
  const pending = new Map<string, PendingConfirm>();
  const exec = vi.fn(async () => ({ ok: true, text: 'OK' }));

  const confirm = vi.fn(
    (req: { id: string; name: string }) =>
      new Promise<boolean>((resolve) => {
        pending.set(req.id, { sessionId: session.id, name: req.name, resolve });
        // Stand in for the user clicking a button in the side panel.
        const outcome = applyConfirm(
          { id: req.id, approved: answer.approved, ...(answer.always ? { always: answer.always } : {}) },
          pending,
          store,
          global,
        );
        outcome?.pending.resolve(outcome.approved);
      }),
  );

  await runAssistant({
    llm: llmCalling(calls),
    exec,
    confirm,
    tools,
    anthropicTools,
    system: 's',
    messages: session.messages,
    onEvent: () => {},
    isAutoApproved: (name) => resolveAutoApproved(session, global, name),
  });

  return { confirm, exec };
}

describe('"always allow" end to end', () => {
  it('does not ask twice for the same tool within one turn', async () => {
    const s = store.create();
    const { confirm, exec } = await runTurn(s, [
      { id: 'c1', name: 'fleex_ticket_link' },
      { id: 'c2', name: 'fleex_ticket_link' },
    ]);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('does not ask again in a LATER turn of the same conversation', async () => {
    const s = store.create();
    await runTurn(s, [{ id: 'c1', name: 'fleex_ticket_link' }]);

    const { confirm, exec } = await runTurn(store.get(s.id)!, [{ id: 'c2', name: 'fleex_ticket_link' }]);

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('does not ask again in a NEW conversation', async () => {
    // The acceptance criterion the previous design could not meet: consent was
    // reset by `create()` on every new conversation.
    await runTurn(store.create(), [{ id: 'c1', name: 'fleex_ticket_link' }]);

    const { confirm, exec } = await runTurn(store.create(), [{ id: 'c2', name: 'fleex_ticket_link' }]);

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('does not ask again after a companion restart', async () => {
    await runTurn(store.create(), [{ id: 'c1', name: 'fleex_ticket_link' }]);

    // Restart: both stores are rebuilt from disk, as on a fresh host process.
    store = new SessionStore(path.join(dir, 'sessions'));
    global = new GlobalAllowlist(dir);

    const { confirm, exec } = await runTurn(store.create(), [{ id: 'c2', name: 'fleex_ticket_link' }]);

    expect(confirm).not.toHaveBeenCalled();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('still asks for a DIFFERENT tool', async () => {
    // Approving `ticket link` must never buy `ticket create`.
    const s = store.create();
    await runTurn(s, [{ id: 'c1', name: 'fleex_ticket_link' }]);

    const { confirm } = await runTurn(store.get(s.id)!, [{ id: 'c2', name: 'fleex_ticket_create' }]);

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('keeps asking in a conversation where a web page was attached', async () => {
    // Prompt-injection guard: a permission earned in a safe conversation must
    // not be cashed in by one carrying untrusted page content.
    await runTurn(store.create(), [{ id: 'c1', name: 'fleex_ticket_link' }]);

    const tainted = store.create();
    disarmForPage(tainted.id, store);

    const { confirm } = await runTurn(store.get(tainted.id)!, [{ id: 'c2', name: 'fleex_ticket_link' }]);

    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('never grants anything when the user declines', async () => {
    const s = store.create();
    const { exec } = await runTurn(
      s,
      [{ id: 'c1', name: 'fleex_ticket_link' }, { id: 'c2', name: 'fleex_ticket_link' }],
      { approved: false, always: 'tool' },
    );

    expect(exec).not.toHaveBeenCalled();
    expect(global.list()).toEqual([]);
  });
});

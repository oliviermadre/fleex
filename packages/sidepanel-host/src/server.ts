#!/usr/bin/env bun
/**
 * fleex-sidepanel-host — local companion for the Chrome side panel assistant.
 *
 * Holds the Anthropic API key, runs the tool-use loop server-side, gates
 * mutating tool calls behind a WebSocket confirmation round-trip, and executes
 * tools by running the fleex CLI. The browser extension is a thin client.
 *
 * Config (env):
 *   ANTHROPIC_API_KEY        required for live use
 *   FLEEX_SIDEPANEL_PORT     listen port (default 4399)
 *   FLEEX_SIDEPANEL_MODEL    model id (default claude-opus-4-8)
 *   FLEEX_MCP_BIN/PREFIX     fleex binary + prefix args (in-repo dev)
 */
import type { ServerWebSocket } from 'bun';
import type Anthropic from '@anthropic-ai/sdk';
import { buildProgram } from '@fleex/cli/program';
import { generateTools } from '@fleex/mcp';
import type { ExecOptions } from '@fleex/mcp';
import { runAssistant, type AssistantEvent } from './assistant.ts';
import { toAnthropicTools } from './tools.ts';
import { createClient, createLlm, createExec, DEFAULT_MODEL } from './anthropic.ts';
import { buildSystemPrompt, formatPageContext } from './system-prompt.ts';
import { listWorkspaces } from './workspaces.ts';

interface PageRef { url?: string; title?: string; content: string }

interface WsData {
  messages: Anthropic.MessageParam[];
  workspace?: string;
  page?: PageRef;
  pendingConfirms: Map<string, (approved: boolean) => void>;
  busy: boolean;
}

const PORT = Number(process.env.FLEEX_SIDEPANEL_PORT ?? 4399);
const MODEL = process.env.FLEEX_SIDEPANEL_MODEL ?? DEFAULT_MODEL;

// Shared, built once.
const tools = generateTools(await buildProgram());
const anthropicTools = toAnthropicTools(tools);
const client = createClient();
const llm = createLlm(client, MODEL);

const baseExecOpts: ExecOptions = {
  bin: process.env.FLEEX_MCP_BIN,
  prefixArgs: process.env.FLEEX_MCP_PREFIX ? process.env.FLEEX_MCP_PREFIX.split(' ').filter(Boolean) : undefined,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function send(ws: ServerWebSocket<WsData>, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // socket closed mid-stream; ignore
  }
}

async function handleUserTurn(ws: ServerWebSocket<WsData>, text: string): Promise<void> {
  if (ws.data.busy) {
    send(ws, { type: 'error', message: 'Still working on the previous message.' });
    return;
  }
  ws.data.busy = true;
  try {
    const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text }];
    if (ws.data.page) {
      content.push({ type: 'text', text: formatPageContext(ws.data.page) });
      ws.data.page = undefined; // attach once
    }
    ws.data.messages.push({ role: 'user', content });

    const exec = createExec({ ...baseExecOpts, workspace: ws.data.workspace });
    const confirm = (req: { id: string; name: string; input: Record<string, unknown>; argv: string[] }) =>
      new Promise<boolean>((resolve) => {
        ws.data.pendingConfirms.set(req.id, resolve);
        send(ws, { type: 'confirm_request', id: req.id, name: req.name, argv: req.argv, input: req.input });
      });

    await runAssistant({
      llm,
      exec,
      confirm,
      tools,
      anthropicTools,
      system: buildSystemPrompt({ workspace: ws.data.workspace }),
      messages: ws.data.messages,
      onEvent: (e: AssistantEvent) => send(ws, e),
      workspace: ws.data.workspace,
    });
  } catch (e) {
    send(ws, { type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    ws.data.busy = false;
  }
}

Bun.serve<WsData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/health') {
      return Response.json({ ok: true, tools: tools.length }, { headers: CORS });
    }

    if (url.pathname === '/workspaces') {
      return Response.json(listWorkspaces(), { headers: CORS });
    }

    if (url.pathname === '/chat') {
      const ok = server.upgrade(req, {
        data: { messages: [], pendingConfirms: new Map(), busy: false } satisfies WsData,
      });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    return new Response('Not Found', { status: 404, headers: CORS });
  },
  websocket: {
    message(ws, raw) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }
      switch (msg.type) {
        case 'user':
          if (typeof msg.text === 'string') void handleUserTurn(ws, msg.text);
          break;
        case 'set_workspace':
          ws.data.workspace = typeof msg.workspace === 'string' ? msg.workspace : undefined;
          send(ws, { type: 'workspace', workspace: ws.data.workspace });
          break;
        case 'page':
          if (typeof msg.content === 'string') {
            ws.data.page = {
              content: msg.content,
              url: typeof msg.url === 'string' ? msg.url : undefined,
              title: typeof msg.title === 'string' ? msg.title : undefined,
            };
            send(ws, { type: 'page_attached', title: ws.data.page.title ?? ws.data.page.url ?? 'page' });
          }
          break;
        case 'confirm': {
          const id = typeof msg.id === 'string' ? msg.id : '';
          const resolver = ws.data.pendingConfirms.get(id);
          if (resolver) {
            resolver(msg.approved === true);
            ws.data.pendingConfirms.delete(id);
          }
          break;
        }
        default:
          send(ws, { type: 'error', message: `Unknown message type: ${String(msg.type)}` });
      }
    },
    close(ws) {
      // Resolve any outstanding confirmations as denied so loops unwind.
      for (const resolve of ws.data.pendingConfirms.values()) resolve(false);
      ws.data.pendingConfirms.clear();
    },
  },
});

process.stderr.write(`fleex-sidepanel-host listening on http://localhost:${PORT} (${tools.length} tools)\n`);

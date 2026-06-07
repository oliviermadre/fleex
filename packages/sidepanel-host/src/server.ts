#!/usr/bin/env bun
/**
 * fleex-sidepanel-host — local companion for the Chrome side panel assistant.
 *
 * Holds the Anthropic API key, runs the tool-use loop server-side, gates
 * mutating tool calls behind a WebSocket confirmation round-trip, and executes
 * tools by running the fleex CLI. Manages multiple persisted conversations
 * (sessions) over a single WebSocket, routed by sessionId.
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
import { SessionStore, type TranscriptItem } from './sessions.ts';

interface PageRef { url?: string; title?: string; content: string }
interface WsData { id: string }

/** Events streamed to the client: assistant events plus a server-level error. */
type ServerEvent = AssistantEvent | { type: 'error'; message: string };

const PORT = Number(process.env.FLEEX_SIDEPANEL_PORT ?? 4399);
const MODEL = process.env.FLEEX_SIDEPANEL_MODEL ?? DEFAULT_MODEL;

// Shared, built once.
const tools = generateTools(await buildProgram());
const anthropicTools = toAnthropicTools(tools);
const client = createClient();
const llm = createLlm(client, MODEL);
const store = new SessionStore();

const baseExecOpts: ExecOptions = {
  bin: process.env.FLEEX_MCP_BIN,
  prefixArgs: process.env.FLEEX_MCP_PREFIX ? process.env.FLEEX_MCP_PREFIX.split(' ').filter(Boolean) : undefined,
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// One client at a time in practice, but support several sockets defensively.
const sockets = new Set<ServerWebSocket<WsData>>();
// Pending tool confirmations, keyed by tool_use id (unique per call).
const pendingConfirms = new Map<string, (approved: boolean) => void>();
// Page attached but not yet consumed, keyed by session id.
const pendingPages = new Map<string, PageRef>();

function send(ws: ServerWebSocket<WsData>, msg: unknown): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* socket closed mid-stream */
  }
}

/** Push the current session list to every connected client (drives the sidebar). */
function broadcastSessions(): void {
  const payload = JSON.stringify({ type: 'sessions', sessions: store.list() });
  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

function broadcastEvent(sessionId: string, event: ServerEvent): void {
  const payload = JSON.stringify({ ...event, sessionId });
  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

async function handleUserTurn(sessionId: string, text: string): Promise<void> {
  const session = store.get(sessionId);
  if (!session) return;
  if (session.status !== 'idle') {
    broadcastEvent(sessionId, { type: 'error', message: 'This conversation is still working.' });
    return;
  }

  store.maybeTitleFrom(sessionId, text);

  const content: Anthropic.ContentBlockParam[] = [{ type: 'text', text }];
  const page = pendingPages.get(sessionId);
  if (page) {
    content.push({ type: 'text', text: formatPageContext(page) });
    pendingPages.delete(sessionId);
  }
  session.messages.push({ role: 'user', content });
  session.transcript.push({ role: 'user', text });
  store.setStatus(sessionId, 'working');
  store.save(sessionId);
  broadcastSessions();

  // Build the transcript incrementally from the event stream.
  let assistantBuf = '';
  const toolItems = new Map<string, Extract<TranscriptItem, { tool: unknown }>>();
  const flushAssistant = (): void => {
    if (assistantBuf) {
      session.transcript.push({ role: 'assistant', text: assistantBuf });
      assistantBuf = '';
      store.save(sessionId);
    }
  };

  const onEvent = (e: AssistantEvent): void => {
    broadcastEvent(sessionId, e);
    switch (e.type) {
      case 'text':
        assistantBuf += e.text;
        break;
      case 'tool_call': {
        flushAssistant();
        const item: TranscriptItem = { tool: { name: e.name, argv: e.argv, status: 'running' } };
        session.transcript.push(item);
        toolItems.set(e.id, item as Extract<TranscriptItem, { tool: unknown }>);
        store.save(sessionId);
        break;
      }
      case 'tool_result': {
        const item = toolItems.get(e.id);
        if (item) {
          item.tool.status = e.ok ? 'ok' : 'fail';
          item.tool.text = e.text;
          store.save(sessionId);
        }
        break;
      }
      case 'tool_denied': {
        const item = toolItems.get(e.id);
        if (item) {
          item.tool.status = 'denied';
          store.save(sessionId);
        }
        break;
      }
      case 'done':
        flushAssistant();
        break;
    }
  };

  const exec = createExec({ ...baseExecOpts, workspace: session.workspace });
  const confirm = (req: { id: string; name: string; input: Record<string, unknown>; argv: string[] }) =>
    new Promise<boolean>((resolve) => {
      store.setStatus(sessionId, 'awaiting_input');
      broadcastSessions();
      pendingConfirms.set(req.id, (approved) => {
        store.setStatus(sessionId, 'working');
        broadcastSessions();
        resolve(approved);
      });
      for (const ws of sockets) send(ws, { type: 'confirm_request', sessionId, id: req.id, name: req.name, argv: req.argv, input: req.input });
    });

  try {
    await runAssistant({
      llm,
      exec,
      confirm,
      tools,
      anthropicTools,
      system: buildSystemPrompt({ workspace: session.workspace }),
      messages: session.messages,
      onEvent,
      workspace: session.workspace,
    });
  } catch (e) {
    broadcastEvent(sessionId, { type: 'error', message: e instanceof Error ? e.message : String(e) });
  } finally {
    flushAssistant();
    store.setStatus(sessionId, 'idle');
    store.save(sessionId);
    broadcastSessions();
  }
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

Bun.serve<WsData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (url.pathname === '/health') return Response.json({ ok: true, tools: tools.length }, { headers: CORS });
    if (url.pathname === '/workspaces') return Response.json(listWorkspaces(), { headers: CORS });
    if (url.pathname === '/chat') {
      const ok = server.upgrade(req, { data: { id: crypto.randomUUID() } satisfies WsData });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }
    return new Response('Not Found', { status: 404, headers: CORS });
  },
  websocket: {
    open(ws) {
      sockets.add(ws);
      send(ws, { type: 'sessions', sessions: store.list() });
    },
    message(ws, raw) {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }
      switch (msg.type) {
        case 'list_sessions':
          send(ws, { type: 'sessions', sessions: store.list() });
          break;
        case 'new_session': {
          const s = store.create({ workspace: asString(msg.workspace) });
          broadcastSessions();
          send(ws, { type: 'session_created', id: s.id });
          break;
        }
        case 'open_session': {
          const id = asString(msg.id);
          const s = id ? store.get(id) : undefined;
          if (s) send(ws, { type: 'session_history', id: s.id, transcript: s.transcript });
          break;
        }
        case 'rename_session': {
          const id = asString(msg.id);
          const title = asString(msg.title);
          if (id && title !== undefined) {
            store.rename(id, title);
            broadcastSessions();
          }
          break;
        }
        case 'delete_session': {
          const id = asString(msg.id);
          if (id) {
            store.delete(id);
            pendingPages.delete(id);
            broadcastSessions();
          }
          break;
        }
        case 'set_workspace': {
          const id = asString(msg.id);
          const s = id ? store.get(id) : undefined;
          if (s) {
            s.workspace = asString(msg.workspace);
            store.save(s.id);
            broadcastSessions();
          }
          break;
        }
        case 'user': {
          const id = asString(msg.sessionId);
          const text = asString(msg.text);
          if (id && text) void handleUserTurn(id, text);
          break;
        }
        case 'page': {
          const id = asString(msg.sessionId);
          const content = asString(msg.content);
          if (id && content) {
            pendingPages.set(id, { content, url: asString(msg.url), title: asString(msg.title) });
            send(ws, { type: 'page_attached', sessionId: id, title: asString(msg.title) ?? asString(msg.url) ?? 'page' });
          }
          break;
        }
        case 'confirm': {
          const id = asString(msg.id) ?? '';
          const resolver = pendingConfirms.get(id);
          if (resolver) {
            pendingConfirms.delete(id);
            resolver(msg.approved === true);
          }
          break;
        }
        default:
          send(ws, { type: 'error', message: `Unknown message type: ${String(msg.type)}` });
      }
    },
    close(ws) {
      sockets.delete(ws);
      // Client gone — unwind any awaiting confirmations as denied.
      for (const resolve of pendingConfirms.values()) resolve(false);
      pendingConfirms.clear();
    },
  },
});

process.stderr.write(`fleex-sidepanel-host listening on http://localhost:${PORT} (${tools.length} tools, ${store.list().length} sessions)\n`);

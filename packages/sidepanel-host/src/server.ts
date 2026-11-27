#!/usr/bin/env bun
/**
 * fleex-sidepanel-host — the companion behind the Fleex Assistant (web and
 * desktop panel, mobile tab, Chrome side panel).
 *
 * Each conversation is a Claude Agent SDK session, built with the same options
 * and env as a persona run (`buildSdkOptions('edit')`): every Claude Code tool,
 * the user's MCP servers and skills, the whole `fleex` CLI through Bash,
 * `bypassPermissions`. Its cwd is the conversation folder
 * `<workspacesRoot>/assistant-<id>`; the one thing that asks first is a file
 * write outside that folder. Conversations are multiplexed over one WebSocket.
 *
 * Config (env):
 *   ANTHROPIC_API_KEY        fallback when Claude Code has no login
 *   FLEEX_SIDEPANEL_PORT     listen port (default 4399)
 *   FLEEX_SIDEPANEL_MODEL    model id (default claude-opus-5)
 *   FLEEX_SIDEPANEL_ALLOWED_ORIGINS  extra WebSocket origins (comma-separated)
 *   FLEEX_MCP_BIN/PREFIX     fleex binary + prefix args (in-repo dev)
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { ServerWebSocket } from 'bun';
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { ExecOptions } from '@fleex/mcp';
import { FALLBACK_MODELS } from '@fleex/shared';
import { listWorkspaces, resolveWorkspace } from './workspaces.ts';
import { SessionStore } from './sessions.ts';
import {
  findRunningInstance,
  findWorkspaceServerPort,
  instanceBranch,
} from './instance-discovery.ts';
import { scheduleRemember, cancelRemember } from './remember.ts';
import { Runner, type ClientEvent } from './runner.ts';
import type { QueryFn } from './agent-turn.ts';
import { loadAccessCatalog, type AccessCatalog } from './fleex-access.ts';
import { allWorkspacesRoots, removeWorkDir, workspacesRootFor } from './work-dir.ts';
import { deliverableTypeFor, lastCitedTicket } from './artifacts.ts';
import { attachDeliverable, createRunCli, listTickets } from './fleex-cli.ts';
import { isAllowedOrigin } from './origin.ts';

export const DEFAULT_MODEL = 'claude-opus-5';

interface WsData { id: string }

interface ThemeConfig { activeThemeId: string | null; customThemes: unknown[] }

/** `agentMaxTurns` of a workspace's running server, if any (D9). */
async function fetchMaxTurns(workspace?: string): Promise<number | undefined> {
  const port = await findWorkspaceServerPort(workspace);
  if (!port) return undefined;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/config`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return undefined;
    const cfg = (await r.json()) as { agentMaxTurns?: unknown };
    return typeof cfg.agentMaxTurns === 'number' ? cfg.agentMaxTurns : undefined;
  } catch {
    return undefined;
  }
}

/** Read a live workspace server's theme config (activeThemeId + customThemes). */
async function fetchThemeConfig(serverPort: number): Promise<ThemeConfig> {
  try {
    const r = await fetch(`http://127.0.0.1:${serverPort}/api/config`, { signal: AbortSignal.timeout(2000) });
    if (!r.ok) return { activeThemeId: null, customThemes: [] };
    const cfg = (await r.json()) as { activeThemeId?: string; customThemes?: unknown[] };
    return { activeThemeId: cfg.activeThemeId ?? null, customThemes: cfg.customThemes ?? [] };
  } catch {
    return { activeThemeId: null, customThemes: [] };
  }
}

/**
 * Enrich each configured workspace with its live instance's branch and theme
 * config, so the side panel can color each picker dot with the workspace's own
 * accent and show which branch is running. Workspaces with no live instance
 * come back with branch/activeThemeId null. Probed in parallel.
 */
async function listWorkspacesEnriched() {
  return Promise.all(
    listWorkspaces().map(async (w) => {
      const inst = await findRunningInstance(w.name);
      if (!inst) return { ...w, branch: null, activeThemeId: null, customThemes: [] };
      const theme = await fetchThemeConfig(inst.server);
      return { ...w, branch: instanceBranch(inst.slug), ...theme };
    }),
  );
}

const PORT = Number(process.env.FLEEX_SIDEPANEL_PORT ?? 4399);
const MODEL = process.env.FLEEX_SIDEPANEL_MODEL ?? DEFAULT_MODEL;
const store = new SessionStore();

const baseExecOpts: ExecOptions = {
  bin: process.env.FLEEX_MCP_BIN,
  prefixArgs: process.env.FLEEX_MCP_PREFIX ? process.env.FLEEX_MCP_PREFIX.split(' ').filter(Boolean) : undefined,
};
const runCli = createRunCli(baseExecOpts);

// Badges on `fleex` lines, from the installed CLI's own catalogue. Loaded in
// the background: until it lands, lines simply have no badge.
let accessCatalog: AccessCatalog = new Map();
void loadAccessCatalog(baseExecOpts).then((c) => {
  accessCatalog = c;
});

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// One client at a time in practice, but support several sockets defensively.
const sockets = new Set<ServerWebSocket<WsData>>();

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

function broadcastEvent(sessionId: string, event: ClientEvent): void {
  const payload = JSON.stringify({ ...event, sessionId });
  for (const ws of sockets) {
    try {
      ws.send(payload);
    } catch {
      /* ignore */
    }
  }
}

const runner = new Runner({
  store,
  query: sdkQuery as unknown as QueryFn,
  emit: broadcastEvent,
  sessionsChanged: broadcastSessions,
  resolveWorkspace,
  workspacesRoot: (ws) => workspacesRootFor(ws),
  accessCatalog: () => accessCatalog,
  defaultModel: MODEL,
  maxTurns: fetchMaxTurns,
  apiKey: () => process.env.ANTHROPIC_API_KEY || undefined,
  log: (m) => process.stderr.write(`fleex-sidepanel-host: ${m}\n`),
  // When this conversation goes quiet, offer it to the workspace's memory.
  onTurnEnd: (session) => scheduleRemember(session, (msg, meta) => console.log(msg, meta ?? '')),
});

/** Open a file or reveal a folder with the machine's default app (desktop / local web only). */
function openOnHost(target: string, reveal: boolean): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  const args = reveal && process.platform === 'darwin' ? ['-R', target] : [target];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* nothing to open with */
  }
}

/** Delete a conversation and its folder (R7: the conversation goes even if the folder cannot). */
async function deleteConversation(id: string): Promise<void> {
  const s = store.get(id);
  await runner.forget(id);
  cancelRemember(id);
  const workDir = s?.workDir;
  store.delete(id);
  if (workDir) {
    const err = removeWorkDir(workDir, allWorkspacesRoots());
    if (err) process.stderr.write(`fleex-sidepanel-host: ${err}\n`);
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
    if (url.pathname === '/health') {
      // hasApiKey lets `fleex companion` detect a booted-but-keyless host (e.g.
      // started before ANTHROPIC_API_KEY landed in ~/.fleex/config) and restart
      // it instead of silently reusing one that can't talk to Claude.
      return Response.json(
        { ok: true, engine: 'claude-agent-sdk', hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY) },
        { headers: CORS },
      );
    }
    if (url.pathname === '/workspaces') return Response.json(await listWorkspacesEnriched(), { headers: CORS });
    if (url.pathname === '/models') {
      // Canonical model list (shared with the web app). The host default is
      // marked so the panel can label its "Default" option.
      return Response.json({ models: FALLBACK_MODELS, default: MODEL }, { headers: CORS });
    }
    if (url.pathname === '/theme') {
      // Return the selected workspace's configured theme (from its app_config),
      // resolved branch-agnostically against its running server.
      const ws = url.searchParams.get('workspace') ?? undefined;
      const serverPort = await findWorkspaceServerPort(ws);
      if (!serverPort) return Response.json({}, { headers: CORS });
      return Response.json(await fetchThemeConfig(serverPort), { headers: CORS });
    }
    if (url.pathname === '/chat') {
      // The Assistant runs Bash without asking: only Fleex's own surfaces may drive it.
      if (!isAllowedOrigin(req.headers.get('origin'))) return new Response('Forbidden origin', { status: 403 });
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
          const s = store.create({ workspace: asString(msg.workspace), model: asString(msg.model) });
          broadcastSessions();
          send(ws, { type: 'session_created', id: s.id });
          break;
        }
        /**
         * File an exchange that happened somewhere else into a conversation.
         *
         * Every question the command palette answers from memory is kept here, so
         * asking something is never a thing you lose. Repeated calls with the same
         * id append, which is what keeps a run of follow-ups as one thread rather
         * than a list of one-turn conversations.
         *
         * Deliberately does not reply `session_created`: that activates and opens
         * the conversation, and recording must not yank the assistant view around
         * every time someone uses the palette.
         */
        case 'record_exchange': {
          const id = asString(msg.id);
          const question = asString(msg.question);
          const answer = asString(msg.answer);
          if (!id || !question || !answer) break;
          store.recordExchange({
            id,
            question,
            answer,
            ...(asString(msg.workspace) ? { workspace: asString(msg.workspace)! } : {}),
            ...(asString(msg.model) ? { model: asString(msg.model)! } : {}),
          });
          broadcastSessions();
          break;
        }
        case 'open_session': {
          const id = asString(msg.id);
          const s = id ? store.get(id) : undefined;
          if (s) {
            send(ws, { type: 'session_history', id: s.id, transcript: s.transcript });
            // A confirmation survives a closed panel (R4): show it again.
            for (const req of runner.pendingFor(s.id)) send(ws, { type: 'confirm_request', sessionId: s.id, ...req });
            const mcp = runner.mcpStatus(s.id);
            if (mcp) send(ws, { type: 'mcp_status', sessionId: s.id, servers: mcp });
          }
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
          if (id) void deleteConversation(id).then(broadcastSessions);
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
        case 'set_model': {
          const id = asString(msg.id);
          const s = id ? store.get(id) : undefined;
          if (s) {
            s.model = asString(msg.model);
            store.save(s.id);
            broadcastSessions();
          }
          break;
        }
        case 'user': {
          const id = asString(msg.sessionId);
          const text = asString(msg.text);
          if (id && text) void runner.handleUserTurn(id, text);
          break;
        }
        case 'continue': {
          // After the turn budget ran out (P21): a technical "Continue." turn.
          const id = asString(msg.sessionId);
          if (id) void runner.handleUserTurn(id, 'Continue.', { continued: true });
          break;
        }
        case 'stop': {
          const id = asString(msg.sessionId);
          if (id) void runner.stop(id);
          break;
        }
        case 'page': {
          const id = asString(msg.sessionId);
          const content = asString(msg.content);
          if (id && content) {
            runner.attachPage(id, { content, url: asString(msg.url), title: asString(msg.title) });
            send(ws, { type: 'page_attached', sessionId: id, title: asString(msg.title) ?? asString(msg.url) ?? 'page' });
          }
          break;
        }
        case 'confirm': {
          runner.confirm(msg);
          break;
        }
        case 'set_outside_writes': {
          const id = asString(msg.sessionId);
          if (id && store.setOutsideWritesAllowed(id, msg.allowed === true)) broadcastSessions();
          break;
        }
        case 'open_path':
        case 'reveal_folder': {
          const id = asString(msg.sessionId);
          const target = msg.type === 'reveal_folder' ? (id ? store.get(id)?.workDir : undefined) : asString(msg.path);
          // Only the conversation's own folder and files: a frame must not launch anything else.
          if (id && target && runner.canOpen(id, target)) openOnHost(target, msg.type === 'reveal_folder');
          else send(ws, { type: 'error', sessionId: id, message: 'Ce chemin ne fait pas partie du dossier de la conversation.' });
          break;
        }
        case 'list_tickets': {
          const id = asString(msg.sessionId);
          const s = id ? store.get(id) : undefined;
          if (!s) break;
          const texts = s.transcript.flatMap((i) => ('role' in i ? [i.text] : []));
          listTickets(runCli, resolveWorkspace(s.workspace), asString(msg.query))
            .then((tickets) => send(ws, { type: 'tickets', sessionId: s.id, tickets, preselect: lastCitedTicket(texts) ?? null }))
            .catch((e) => send(ws, { type: 'error', sessionId: s.id, message: e instanceof Error ? e.message : String(e) }));
          break;
        }
        case 'attach_artifact': {
          const id = asString(msg.sessionId);
          const filePath = asString(msg.path);
          const ticketId = asString(msg.ticketId);
          const s = id ? store.get(id) : undefined;
          const card = s && filePath ? runner.artifact(s.id, filePath) : undefined;
          if (!s || !card || !ticketId) {
            send(ws, { type: 'error', sessionId: id, message: 'Artefact ou ticket introuvable.' });
            break;
          }
          if (!card.attachable) {
            send(ws, { type: 'error', sessionId: s.id, message: 'Format ou taille non pris en charge comme livrable.' });
            break;
          }
          void attachDeliverable(runCli, resolveWorkspace(s.workspace), {
            ticketId,
            file: card.path,
            title: card.name,
            type: deliverableTypeFor(card.path),
          }).then((res) => {
            if (!res.ok) {
              send(ws, { type: 'artifact_attach_failed', sessionId: s.id, path: card.path, message: (res.stderr || res.stdout).trim() || 'fleex ticket deliverable add failed' });
              return;
            }
            card.attachments.push({ ticketId, displayId: asString(msg.displayId) ?? ticketId });
            store.save(s.id);
            broadcastEvent(s.id, { type: 'artifact', turnId: card.turnId, card, replaces: true });
          });
          break;
        }
        default:
          send(ws, { type: 'error', message: `Unknown message type: ${String(msg.type)}` });
      }
    },
    close(ws) {
      // A pending confirmation outlives the socket (R4): it is shown again on reopen.
      sockets.delete(ws);
    },
  },
});

// ── Dev hot reload (opt-in) ───────────────────────────────────────────────--
// With FLEEX_SIDEPANEL_DEV=1, watch the extension directory and tell the side
// panel to reload on change: a panel `location.reload()` for side-panel files,
// or a full `chrome.runtime.reload()` when manifest/background change.
if (process.env.FLEEX_SIDEPANEL_DEV === '1') {
  const extDir = process.env.FLEEX_EXTENSION_DIR ?? path.resolve(import.meta.dir, '../../../extension');
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fullPending = false;
  try {
    fs.watch(extDir, { recursive: true }, (_evt, filename) => {
      const name = filename ? String(filename) : '';
      if (!name || name.startsWith('.') || name.endsWith('~') || name.endsWith('.swp')) return;
      if (name === 'manifest.json' || name === 'background.js') fullPending = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const payload = JSON.stringify({ type: 'dev_reload', full: fullPending });
        for (const ws of sockets) { try { ws.send(payload); } catch { /* ignore */ } }
        process.stderr.write(`fleex-sidepanel-host: dev reload (${fullPending ? 'full' : 'panel'}) — ${name}\n`);
        fullPending = false;
        timer = null;
      }, 150);
    });
    process.stderr.write(`fleex-sidepanel-host: dev hot reload watching ${extDir}\n`);
  } catch (e) {
    process.stderr.write(`fleex-sidepanel-host: dev reload unavailable (${e instanceof Error ? e.message : String(e)})\n`);
  }
}

process.stderr.write(`fleex-sidepanel-host listening on http://localhost:${PORT} (Claude Agent SDK, ${store.list().length} sessions)\n`);

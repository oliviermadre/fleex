import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import {
  WS_PATH,
  DASHBOARD_BROADCAST_INTERVAL_MS,
  DEFAULT_COLS,
  DEFAULT_ROWS,
} from '@fleex/shared';
import type { PtyHandle, DashboardMessage, WsChannel } from '@fleex/shared';
import type { Container } from '../container.js';
import type { JsonlFileWatcher } from '../services/jsonl-file-watcher.js';
import type { WsHeartbeat } from './ws-heartbeat.js';
import { encodePath } from '../../domain/services/claude-path-encoding.js';
import { DiffStatsCache } from '../../domain/services/diff-stats-cache.js';

// Binary protocol constants (match shared ClientMessageType / ServerMessageType)
const CLIENT_ATTACH = 0x01;
const CLIENT_INPUT = 0x02;
const CLIENT_RESIZE = 0x03;
const CLIENT_DETACH = 0x04;

const SERVER_ATTACHED = 0x01;
const SERVER_OUTPUT = 0x02;
const SERVER_EXIT = 0x03;
const SERVER_ERROR = 0x04;

interface UnifiedClient {
  socket: WebSocket;
  // Terminal state — keyed by sessionId, supports multiple concurrent PTYs
  ptyHandles: Map<string, PtyHandle>;
  // Agent events subscription state
  subscribedExecutions: Set<string>;
  subscribedTickets: Set<string>;
  // Subscribe to ALL execution start/end events (for execution log page)
  subscribedToAllExecutions: boolean;
}

function sendChannelJson(ws: WebSocket, channel: WsChannel, msg: { type: string; data: unknown }): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify({ channel, ...msg }));
  }
}

function sendBinary(ws: WebSocket, data: Buffer): void {
  if (ws.readyState === 1) {
    ws.send(data);
  }
}

function sendTerminalError(ws: WebSocket, sessionId: string, message: string): void {
  const sidBuf = Buffer.from(sessionId, 'utf-8');
  const msgBuf = Buffer.from(message, 'utf-8');
  const frame = Buffer.allocUnsafe(1 + 1 + sidBuf.length + msgBuf.length);
  frame[0] = SERVER_ERROR;
  frame[1] = sidBuf.length;
  sidBuf.copy(frame, 2);
  msgBuf.copy(frame, 2 + sidBuf.length);
  sendBinary(ws, frame);
}

function parseSessionPrefix(data: Buffer, offset: number): { sessionId: string; rest: Buffer } {
  const sidLen = data[offset] ?? 0;
  const sessionId = data.subarray(offset + 1, offset + 1 + sidLen).toString('utf-8');
  const rest = data.subarray(offset + 1 + sidLen);
  return { sessionId, rest };
}

function parseAttachPayload(payload: Buffer): { sessionId: string; cols: number; rows: number } {
  const nullIdx = payload.indexOf(0x00);
  if (nullIdx === -1) {
    return { sessionId: payload.toString('utf-8'), cols: DEFAULT_COLS, rows: DEFAULT_ROWS };
  }
  const sessionId = payload.subarray(0, nullIdx).toString('utf-8');
  const rest = payload.subarray(nullIdx + 1);
  const cols = rest.length >= 2 ? rest.readUInt16BE(0) : DEFAULT_COLS;
  const rows = rest.length >= 4 ? rest.readUInt16BE(2) : DEFAULT_ROWS;
  return { sessionId, cols, rows };
}

export function unifiedWsPlugin(container: Container, fileWatcher: JsonlFileWatcher | undefined, heartbeat: WsHeartbeat) {
  return async function (app: FastifyInstance) {
    const clients = new Map<WebSocket, UnifiedClient>();

    // ─── Diff stats cache (refreshed every 60s, injected into each broadcast) ───
    const diffStatsCache = new DiffStatsCache(container.git, container.logger);

    // ─── Dashboard broadcast logic (ported from dashboard-ws.ts) ───
    let broadcastInFlight = false;
    let pendingBroadcast = false;
    let lastDashboardPayload = '';

    async function dashboardBroadcast(): Promise<void> {
      if (clients.size === 0) return;
      if (broadcastInFlight) { pendingBroadcast = true; return; }

      broadcastInFlight = true;
      try {
        const groups = await container.getSessionGroups.execute();
        diffStatsCache.inject(groups);
        const message: DashboardMessage = { type: 'sessions:updated', data: groups };
        const payload = JSON.stringify({ channel: 'dashboard' as WsChannel, ...message });

        if (payload !== lastDashboardPayload) {
          lastDashboardPayload = payload;
          for (const client of clients.values()) {
            if (client.socket.readyState === 1) {
              client.socket.send(payload);
            }
          }
        }

        if (fileWatcher) reconcileWatchers(groups);
      } catch (err) {
        container.logger.error('Dashboard broadcast failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        broadcastInFlight = false;
        if (pendingBroadcast) { pendingBroadcast = false; dashboardBroadcast(); }
      }
    }

    function reconcileWatchers(groups: Awaited<ReturnType<typeof container.getSessionGroups.execute>>): void {
      if (!fileWatcher) return;
      const activeDirs = new Set<string>();
      for (const group of groups) {
        for (const worktree of group.worktrees) {
          for (const session of worktree.sessions) {
            if (session.type === 'claude' && session.status === 'running') {
              const encoded = encodePath(session.cwd);
              const projectDir = path.join(container.hostHomedir, '.claude', 'projects', encoded);
              activeDirs.add(projectDir);
            }
          }
        }
      }
      for (const dir of activeDirs) fileWatcher.watchDirectory(dir);
      for (const dir of fileWatcher.getWatchedDirectories()) {
        if (!activeDirs.has(dir)) fileWatcher.unwatchDirectory(dir);
      }
    }

    const dashboardInterval = setInterval(() => dashboardBroadcast(), DASHBOARD_BROADCAST_INTERVAL_MS);
    if (fileWatcher) {
      fileWatcher.on('change', () => dashboardBroadcast());
    }

    // Re-broadcast immediately when a Claude Code hook updates a session's hookStatus.
    // The diff guard inside dashboardBroadcast prevents redundant pushes.
    container.eventBus.on('session.hookStatusChanged', () => {
      dashboardBroadcast();
    });

    // Refresh diff stats every 60s (non-blocking — runs git diff in background)
    const DIFF_STATS_INTERVAL_MS = 60_000;
    async function refreshDiffStats(): Promise<void> {
      try {
        const groups = await container.getSessionGroups.execute();
        await diffStatsCache.refresh(groups);
      } catch { /* ignore */ }
    }
    refreshDiffStats(); // initial refresh on startup
    const diffStatsInterval = setInterval(() => refreshDiffStats(), DIFF_STATS_INTERVAL_MS);

    // ─── Channel broadcast helper (for repositories, tickets, personas, skills) ───
    function channelBroadcast(channel: WsChannel, type: string, data: unknown): void {
      if (clients.size === 0) return;
      const payload = JSON.stringify({ channel, type, data });
      for (const client of clients.values()) {
        if (client.socket.readyState === 1) {
          client.socket.send(payload);
        }
      }
    }

    // Wire up repository scheduler broadcast
    container.repositoryRefreshScheduler.setBroadcast((type, data) =>
      channelBroadcast('repositories', type, data)
    );

    // Wire up ticket broadcast
    const ticketBroadcast = (type: string, data: unknown) => channelBroadcast('tickets', type, data);
    container.ticketBroadcast = ticketBroadcast;
    container.domainEventListener.setTicketBroadcast(ticketBroadcast);

    // Mirror the SDK execution lifecycle onto the board-wide `tickets` channel so
    // the cockpit ACTIVITY column reconciles for EVERY launch origin. Mention-driven
    // runs already reconcile via `mention:*` and workflow steps via `workflow:*`,
    // but a skill / panel / direct launch emits neither — its badge stayed frozen
    // (idle at launch, running after completion) until the view was refreshed.
    //
    // Hooked on the execution cache rather than the event stream on purpose: the
    // cache is what the agent-activity endpoint reads, so the reconcile this
    // triggers can never race ahead of the status it is meant to observe.
    container.agentEventStore.onExecutionLifecycle = ({ executionId, ticketId, status }) => {
      if (!ticketId) return; // routine runs have no ticket — nothing to reconcile
      ticketBroadcast(status === 'running' ? 'execution:started' : 'execution:ended', {
        executionId,
        ticketId,
      });
    };

    // Wire up persona broadcast
    const personaBroadcast = (type: string, data: unknown) => channelBroadcast('personas', type, data);
    container.personaBroadcast = personaBroadcast;
    container.domainEventListener.setPersonaBroadcast(personaBroadcast);

    // Wire up skill broadcast
    const skillBroadcast = (type: string, data: unknown) => channelBroadcast('skills', type, data);
    container.skillBroadcast = skillBroadcast;
    container.domainEventListener.setSkillBroadcast(skillBroadcast);

    // ─── Agent events batching (ported from agent-events-ws.ts) ───
    let batchBuffer: { client: UnifiedClient; payload: string }[] = [];
    let batchTimer: ReturnType<typeof setTimeout> | null = null;

    const flushBatch = () => {
      const batch = batchBuffer;
      batchBuffer = [];
      batchTimer = null;
      for (const { client, payload } of batch) {
        if (client.socket.readyState === 1) {
          client.socket.send(payload);
        }
      }
    };

    const broadcastAgentEvent = (event: { toDTO: () => { executionId: string; eventType: string; data: unknown } }) => {
      if (clients.size === 0) return;
      const dto = event.toDTO();
      const executionId = dto.executionId;
      const payload = JSON.stringify({ channel: 'agent-events' as WsChannel, type: 'agent_event:delta', data: dto });

      for (const client of clients.values()) {
        if (client.subscribedExecutions.has(executionId)) {
          batchBuffer.push({ client, payload });
        }
      }

      if (dto.eventType === 'execution_start' || dto.eventType === 'execution_end' || dto.eventType === 'error') {
        const ticketId = (dto.data as Record<string, unknown>)?.['ticketId'] as string | undefined;
        for (const client of clients.values()) {
          // Skip clients already subscribed to this execution
          if (client.subscribedExecutions.has(executionId)) continue;
          // Send to ticket subscribers
          if (ticketId && client.subscribedTickets.has(ticketId)) {
            batchBuffer.push({ client, payload });
          } else if (client.subscribedToAllExecutions) {
            // Send to clients subscribed to all execution lifecycle events
            batchBuffer.push({ client, payload });
          }
        }
      }

      if (!batchTimer) {
        batchTimer = setTimeout(flushBatch, 50);
      }
    };

    container.executeAgent.onEvent = broadcastAgentEvent;
    container.runPanel.onEvent = broadcastAgentEvent;

    container.executeAgent.onExecutionComplete = (personaId, status, _mentionId) => {
      const type = status === 'completed' ? 'persona:execution_completed' : 'persona:execution_failed';
      container.personaBroadcast(type, { personaId });
    };

    container.agentEventBroadcast = (msg: unknown) => {
      if (clients.size === 0) return;
      const payload = JSON.stringify({ channel: 'agent-events' as WsChannel, ...(msg as Record<string, unknown>) });
      for (const client of clients.values()) {
        if (client.socket.readyState === 1) {
          client.socket.send(payload);
        }
      }
    };

    // ─── Unified WS route ───
    app.get(WS_PATH, { websocket: true }, (socket) => {
      const ws = socket as unknown as WebSocket;

      const client: UnifiedClient = {
        socket: ws,
        ptyHandles: new Map(),
        subscribedExecutions: new Set(),
        subscribedTickets: new Set(),
        subscribedToAllExecutions: false,
      };
      clients.set(ws, client);
      heartbeat.register(ws);

      ws.on('error', (err) => {
        container.logger.error('WS error on /ws', { error: String(err) });
        ws.terminate();
      });

      ws.on('message', async (raw: Buffer, isBinary: boolean) => {
        if (isBinary) {
          // Binary frame → terminal protocol
          const data = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
          if (data.length === 0) return;

          const msgType = data[0];

          switch (msgType) {
            case CLIENT_ATTACH: {
              const payload = data.subarray(1);
              const { sessionId, cols, rows } = parseAttachPayload(payload);

              // If already attached, kill old PTY and re-attach (handles React StrictMode double-mount)
              const existingHandle = client.ptyHandles.get(sessionId);
              if (existingHandle) {
                container.logger.info('Re-attaching to session, killing old PTY', { sessionId });
                client.ptyHandles.delete(sessionId);
                existingHandle.kill();
              }

              try {
                container.logger.info('Terminal ATTACH request', { sessionId, cols, rows });

                const session = await container.sessionStore.getById(sessionId);
                if (!session) {
                  container.logger.warn('Session not found for attach', { sessionId });
                  sendTerminalError(ws, sessionId, `Session not found: ${sessionId}`);
                  return;
                }

                session.markAttached();
                await container.sessionStore.save(session);

                const sidBuf = Buffer.from(sessionId, 'utf-8');

                container.logger.info('Spawning PTY for tmux attach', { tmuxName: session.tmuxName });
                const handle = container.pty.spawnAttach(session.tmuxName, { cols, rows });
                client.ptyHandles.set(sessionId, handle);

                handle.onData((chunk: Buffer) => {
                  if (client.ptyHandles.get(sessionId) !== handle) return;
                  const msg = Buffer.allocUnsafe(1 + 1 + sidBuf.length + chunk.length);
                  msg[0] = SERVER_OUTPUT;
                  msg[1] = sidBuf.length;
                  sidBuf.copy(msg, 2);
                  chunk.copy(msg, 2 + sidBuf.length);
                  sendBinary(ws, msg);
                });

                handle.onExit((exitCode: number) => {
                  container.logger.info('PTY exited', { exitCode, tmuxName: session.tmuxName });
                  if (client.ptyHandles.get(sessionId) !== handle) return;
                  const msg = Buffer.allocUnsafe(1 + 1 + sidBuf.length + 1);
                  msg[0] = SERVER_EXIT;
                  msg[1] = sidBuf.length;
                  sidBuf.copy(msg, 2);
                  msg[2 + sidBuf.length] = exitCode & 0xff;
                  sendBinary(ws, msg);
                  client.ptyHandles.delete(sessionId);
                });

                // ATTACHED: [0x01][sidLen][sid]
                const attachedMsg = Buffer.allocUnsafe(1 + 1 + sidBuf.length);
                attachedMsg[0] = SERVER_ATTACHED;
                attachedMsg[1] = sidBuf.length;
                sidBuf.copy(attachedMsg, 2);
                sendBinary(ws, attachedMsg);
                container.logger.info('Terminal ATTACHED confirmation sent', { sessionId });
              } catch (err) {
                container.logger.error('Terminal attach failed', { error: err instanceof Error ? err.message : String(err) });
                sendTerminalError(ws, sessionId, err instanceof Error ? err.message : 'Attach failed');
              }
              break;
            }
            case CLIENT_INPUT: {
              const { sessionId: sid, rest } = parseSessionPrefix(data, 1);
              const handle = client.ptyHandles.get(sid);
              if (handle?.isAlive) {
                handle.write(rest.toString());
              }
              break;
            }
            case CLIENT_RESIZE: {
              const { sessionId: sid, rest } = parseSessionPrefix(data, 1);
              const handle = client.ptyHandles.get(sid);
              if (handle?.isAlive && rest.length >= 4) {
                const cols = rest.readUInt16BE(0);
                const rows = rest.readUInt16BE(2);
                handle.resize({ cols, rows });
              }
              break;
            }
            case CLIENT_DETACH: {
              const { sessionId: sid } = parseSessionPrefix(data, 1);
              const handle = client.ptyHandles.get(sid);
              if (handle) {
                handle.kill();
                client.ptyHandles.delete(sid);
              }
              break;
            }
          }
        } else {
          // Text frame → JSON channel message
          try {
            const msg = JSON.parse(raw.toString());
            if (msg.channel === 'agent-events') {
              if (msg.action === 'subscribe') {
                if (msg.executionId) client.subscribedExecutions.add(msg.executionId);
                if (msg.ticketId) client.subscribedTickets.add(msg.ticketId);
                if (msg.allExecutions) client.subscribedToAllExecutions = true;
              } else if (msg.action === 'unsubscribe') {
                if (msg.executionId) client.subscribedExecutions.delete(msg.executionId);
                if (msg.ticketId) client.subscribedTickets.delete(msg.ticketId);
                if (msg.allExecutions) client.subscribedToAllExecutions = false;
              }
            }
          } catch {
            // Ignore malformed JSON
          }
        }
      });

      ws.on('close', () => {
        for (const handle of client.ptyHandles.values()) {
          handle.kill();
        }
        client.ptyHandles.clear();
        clients.delete(ws);
        heartbeat.unregister(ws);
      });
    });

    app.addHook('onClose', () => {
      clearInterval(dashboardInterval);
      clearInterval(diffStatsInterval);
      if (batchTimer) clearTimeout(batchTimer);
      if (fileWatcher) fileWatcher.closeAll();
      for (const client of clients.values()) {
        client.socket.close();
      }
      clients.clear();
    });
  };
}

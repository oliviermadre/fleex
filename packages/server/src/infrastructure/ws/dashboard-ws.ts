import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_DASHBOARD_PATH } from '@fleex/shared';
import type { DashboardMessage } from '@fleex/shared';
import type { Container } from '../container.js';
import type { JsonlFileWatcher } from '../services/jsonl-file-watcher.js';
import { encodePath } from '../../domain/services/claude-path-encoding.js';

/** Debounce delay (ms) to coalesce rapid event bursts into a single broadcast. */
const BROADCAST_DEBOUNCE_MS = 500;

/** Debounce delay for usage broadcasts — less urgent than session data. */
const USAGE_BROADCAST_DEBOUNCE_MS = 5_000;

export function dashboardWsPlugin(container: Container, fileWatcher?: JsonlFileWatcher) {
  return async function (app: FastifyInstance) {
    const clients = new Set<WebSocket>();

    let broadcastInFlight = false;
    let pendingBroadcast = false;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let usageDebounceTimer: ReturnType<typeof setTimeout> | null = null;

    async function broadcast(): Promise<void> {
      if (clients.size === 0) return;

      if (broadcastInFlight) {
        pendingBroadcast = true;
        return;
      }

      broadcastInFlight = true;
      try {
        const groups = await container.getSessionGroups.execute();
        const message: DashboardMessage = {
          type: 'sessions:updated',
          data: groups,
        };
        const payload = JSON.stringify(message);

        for (const client of clients) {
          if (client.readyState === 1) {
            client.send(payload);
          }
        }

        if (fileWatcher) {
          reconcileWatchers(groups);
        }
      } catch (err) {
        container.logger.error('Dashboard broadcast failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        broadcastInFlight = false;
        if (pendingBroadcast) {
          pendingBroadcast = false;
          broadcast();
        }
      }
    }

    /** Schedule a debounced broadcast — coalesces rapid events. */
    function scheduleBroadcast(): void {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        broadcast();
      }, BROADCAST_DEBOUNCE_MS);
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

      // Add watchers for new dirs
      for (const dir of activeDirs) {
        fileWatcher.watchDirectory(dir);
      }

      // Remove watchers for dirs no longer active
      for (const dir of fileWatcher.getWatchedDirectories()) {
        if (!activeDirs.has(dir)) {
          fileWatcher.unwatchDirectory(dir);
        }
      }
    }

    app.get(WS_DASHBOARD_PATH, { websocket: true }, (socket) => {
      clients.add(socket as unknown as WebSocket);

      // Send current state immediately on connect
      broadcast();

      socket.on('close', () => {
        clients.delete(socket as unknown as WebSocket);
      });
    });

    // Event-driven broadcasts: react to session lifecycle domain events
    const { eventBus } = container;
    eventBus.on('session.created', () => scheduleBroadcast());
    eventBus.on('session.killed', () => scheduleBroadcast());
    eventBus.on('session.renamed', () => scheduleBroadcast());

    // Also react to ticket/persona events that affect agent worktree info in the dashboard
    eventBus.on('ticket.created', () => scheduleBroadcast());
    eventBus.on('ticket.updated', () => scheduleBroadcast());
    eventBus.on('ticket.moved', () => scheduleBroadcast());
    eventBus.on('ticket.deleted', () => scheduleBroadcast());
    eventBus.on('persona.created', () => scheduleBroadcast());
    eventBus.on('persona.updated', () => scheduleBroadcast());
    eventBus.on('persona.deleted', () => scheduleBroadcast());
    eventBus.on('persona.execution_started', () => scheduleBroadcast());

    // ── Usage broadcasting ──

    async function broadcastUsage(): Promise<void> {
      if (clients.size === 0) return;
      try {
        const usage = await container.getClaudeUsage.execute();
        if (!usage) return;
        const message: DashboardMessage = { type: 'usage:updated', data: usage };
        const payload = JSON.stringify(message);
        for (const client of clients) {
          if (client.readyState === 1) {
            client.send(payload);
          }
        }
      } catch {
        // Usage fetch failures are non-critical
      }
    }

    function scheduleUsageBroadcast(): void {
      if (usageDebounceTimer) return; // Already scheduled — don't reset
      usageDebounceTimer = setTimeout(() => {
        usageDebounceTimer = null;
        broadcastUsage();
      }, USAGE_BROADCAST_DEBOUNCE_MS);
    }

    // Broadcast usage when sessions change (new Claude sessions affect usage)
    eventBus.on('session.created', () => scheduleUsageBroadcast());
    eventBus.on('session.killed', () => scheduleUsageBroadcast());

    // Instant broadcasts on JSONL file changes (claude activity updates)
    if (fileWatcher) {
      fileWatcher.on('change', () => {
        scheduleBroadcast();
        scheduleUsageBroadcast();
      });
    }

    app.addHook('onClose', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      if (usageDebounceTimer) clearTimeout(usageDebounceTimer);
      if (fileWatcher) {
        fileWatcher.closeAll();
      }
      for (const client of clients) {
        client.close();
      }
      clients.clear();
    });
  };
}

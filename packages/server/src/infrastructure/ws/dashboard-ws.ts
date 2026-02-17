import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_DASHBOARD_PATH, DASHBOARD_BROADCAST_INTERVAL_MS } from '@asm/shared';
import type { DashboardMessage } from '@asm/shared';
import type { Container } from '../container.js';
import type { JsonlFileWatcher } from '../services/jsonl-file-watcher.js';
import { encodePath } from '../../domain/services/claude-path-encoding.js';

export function dashboardWsPlugin(container: Container, fileWatcher?: JsonlFileWatcher) {
  return async function (app: FastifyInstance) {
    const clients = new Set<WebSocket>();

    let broadcastInFlight = false;
    let pendingBroadcast = false;

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

      socket.on('close', () => {
        clients.delete(socket as unknown as WebSocket);
      });
    });

    // Poll interval for CPU/process discovery
    const interval = setInterval(() => broadcast(), DASHBOARD_BROADCAST_INTERVAL_MS);

    // Instant broadcasts on JSONL file changes
    if (fileWatcher) {
      fileWatcher.on('change', () => broadcast());
    }

    app.addHook('onClose', () => {
      clearInterval(interval);
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

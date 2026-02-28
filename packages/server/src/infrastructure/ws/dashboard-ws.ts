import * as path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import { WS_DASHBOARD_PATH, DASHBOARD_BROADCAST_INTERVAL_MS } from '@asm/shared';
import type { DashboardMessage } from '@asm/shared';
import type { Container } from '../container.js';
import type { JsonlFileWatcher } from '../services/jsonl-file-watcher.js';
import { encodePath } from '../../domain/services/claude-path-encoding.js';
import { requestContext } from '../request-context.js';

interface AuthenticatedClient {
  socket: WebSocket;
  userId: string;
}

export function dashboardWsPlugin(container: Container, fileWatcher?: JsonlFileWatcher) {
  return async function (app: FastifyInstance) {
    const clients = new Set<AuthenticatedClient>();

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
        // Group clients by userId so we query once per user.
        const userClients = new Map<string, WebSocket[]>();
        for (const client of clients) {
          if (client.socket.readyState !== 1) continue;
          let list = userClients.get(client.userId);
          if (!list) {
            list = [];
            userClients.set(client.userId, list);
          }
          list.push(client.socket);
        }

        for (const [userId, sockets] of userClients) {
          try {
            // Run the session query within this user's request context
            // so that the session store filters by their userId.
            const groups = await requestContext.run({ userId }, () =>
              container.getSessionGroups.execute(),
            );
            const message: DashboardMessage = {
              type: 'sessions:updated',
              data: groups,
            };
            const payload = JSON.stringify(message);

            for (const ws of sockets) {
              if (ws.readyState === 1) {
                ws.send(payload);
              }
            }

            if (fileWatcher) {
              reconcileWatchers(groups);
            }
          } catch (err) {
            container.logger.error('Dashboard broadcast failed for user', {
              userId,
              error: err instanceof Error ? err.message : String(err),
            });
          }
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

    app.get(WS_DASHBOARD_PATH, { websocket: true }, (socket, req) => {
      const userId = req.userId;
      if (!userId) {
        socket.close();
        return;
      }
      const client: AuthenticatedClient = { socket: socket as unknown as WebSocket, userId };
      clients.add(client);

      socket.on('close', () => {
        clients.delete(client);
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
        client.socket.close();
      }
      clients.clear();
    });
  };
}

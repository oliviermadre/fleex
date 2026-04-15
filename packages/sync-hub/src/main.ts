import { logAlways, logInfo, logDebug, logError, getVerbosity } from './logger';

const PORT = parseInt(process.env['SYNC_HUB_PORT'] ?? '3002', 10);
const AUTH_TOKEN = process.env['FLEEX_SYNC_TOKEN'] ?? '';

// ── Client registry ──

interface SyncClient {
  instanceId: string;
  ws: ServerWebSocket<WsData>;
  connectedAt: number;
}

interface WsData {
  instanceId: string | null;
}

const clients = new Map<string, SyncClient>();

// ── Server ──

Bun.serve<WsData>({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/health') {
      return Response.json({
        ok: true,
        clients: clients.size,
        instances: [...clients.keys()],
      });
    }

    if (url.pathname === '/ws') {
      // Auth check
      if (AUTH_TOKEN) {
        const token = url.searchParams.get('token');
        if (token !== AUTH_TOKEN) {
          return new Response('Unauthorized', { status: 401 });
        }
      }

      const ok = server.upgrade(req, {
        data: { instanceId: null },
      });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      logInfo('New WebSocket connection');
    },

    message(ws, raw) {
      let msg: { type: string; instanceId?: string; [key: string]: unknown };
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      } catch {
        logError('Invalid JSON received, dropping message');
        return;
      }

      // Identify handshake
      if (msg.type === 'identify' && typeof msg.instanceId === 'string') {
        ws.data.instanceId = msg.instanceId;

        // Remove stale connection with same instanceId (reconnect scenario)
        const existing = clients.get(msg.instanceId);
        if (existing && existing.ws !== ws) {
          logInfo(`Replacing stale connection for ${msg.instanceId}`);
          try { existing.ws.close(1000, 'replaced'); } catch { /* ignore */ }
        }

        clients.set(msg.instanceId, {
          instanceId: msg.instanceId,
          ws,
          connectedAt: Date.now(),
        });

        ws.send(JSON.stringify({ type: 'identified', instanceId: msg.instanceId, clients: clients.size }));
        logInfo(`Instance identified: ${msg.instanceId} (${clients.size} total)`);
        return;
      }

      // Require identification before relaying
      if (!ws.data.instanceId) {
        ws.send(JSON.stringify({ type: 'error', message: 'Send identify message first' }));
        return;
      }

      // Relay event to all other instances
      if (msg.type === 'event') {
        const senderId = ws.data.instanceId;
        const payload = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        let relayed = 0;

        for (const [id, client] of clients) {
          if (id === senderId) continue;
          try {
            client.ws.send(payload);
            relayed++;
          } catch {
            logError(`Failed to relay to ${id}, removing`);
            clients.delete(id);
          }
        }

        logDebug(`Relayed event ${msg.eventType ?? '?'} from ${senderId} to ${relayed} instances`);
      }
    },

    close(ws) {
      const id = ws.data.instanceId;
      if (id) {
        // Only delete if this is still the active connection for that instanceId
        const current = clients.get(id);
        if (current && current.ws === ws) {
          clients.delete(id);
          logInfo(`Instance disconnected: ${id} (${clients.size} remaining)`);
        }
      }
    },
  },
});

// ── Periodic health log ──

setInterval(() => {
  if (clients.size > 0) {
    logDebug(`Connected instances: ${[...clients.keys()].join(', ')}`);
  }
}, 30_000);

const verbLabel = getVerbosity() >= 2 ? ' (debug)' : getVerbosity() >= 1 ? ' (verbose)' : '';
logAlways(`Fleex Sync Hub listening on ws://localhost:${PORT}/ws${verbLabel}`);
if (!AUTH_TOKEN) {
  logAlways('Warning: No FLEEX_SYNC_TOKEN set — running without authentication');
}

// Bun types
type ServerWebSocket<T> = ReturnType<typeof Bun.serve>['websocket'] extends { message: (ws: infer W, ...args: any[]) => any } ? W : any;

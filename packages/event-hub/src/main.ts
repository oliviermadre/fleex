import type { HubMessage } from '@fleex/shared';
import { Hub, type HubClientData } from './hub';
import { ClientsStore, CLIENTS_FILE } from './clients';

const PORT = parseInt(process.env['FLEEX_EVENT_HUB_PORT'] ?? '3002', 10);

const hub = new Hub();
const clientsStore = new ClientsStore();

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  const suffix = ctx ? ' ' + JSON.stringify(ctx) : '';
  process.stdout.write(`[${stamp}] [${level}] ${msg}${suffix}\n`);
}

clientsStore.startWatch(() => {
  const closed = hub.disconnectRevoked((name) => clientsStore.has(name));
  if (closed.length > 0) {
    log('info', 'authorized clients changed — disconnected revoked sockets', { closed });
  } else {
    log('info', 'authorized clients changed — no active sockets affected');
  }
});

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1]!.trim() : null;
}

Bun.serve<HubClientData>({
  port: PORT,

  fetch(req, server) {
    const url = new URL(req.url);

    if (url.pathname === '/health' && req.method === 'GET') {
      const stats = hub.stats();
      return Response.json({
        ok: true,
        port: PORT,
        authorizedClients: clientsStore.count(),
        ...stats,
        uptimeMs: Date.now() - stats.startedAt,
      });
    }

    if (url.pathname === '/events') {
      const token = extractBearerToken(req);
      if (!token) {
        return new Response('Missing Authorization: Bearer <token>', { status: 401 });
      }
      const clientName = clientsStore.verify(token);
      if (!clientName) {
        return new Response('Unknown or revoked token', { status: 401 });
      }
      const ok = server.upgrade(req, {
        data: {
          clientName,
          serverId: null,
          pid: null,
          hostname: null,
          connectedAt: Date.now(),
        } satisfies HubClientData,
      });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      hub.register(ws);
      log('info', 'client connected', { clientName: ws.data.clientName });
    },

    message(ws, raw) {
      let msg: HubMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      } catch {
        log('warn', 'invalid message (not JSON)', { clientName: ws.data.clientName });
        return;
      }

      switch (msg.kind) {
        case 'hello':
          ws.data.serverId = msg.serverId;
          ws.data.pid = msg.pid;
          ws.data.hostname = msg.hostname;
          log('info', 'hello', {
            clientName: ws.data.clientName,
            serverId: msg.serverId,
            pid: msg.pid,
            hostname: msg.hostname,
            version: msg.version,
          });
          break;

        case 'event':
          if (!ws.data.serverId) {
            log('warn', 'event received before hello — dropping', { clientName: ws.data.clientName });
            return;
          }
          if (msg.originatorServerId !== ws.data.serverId) {
            log('warn', 'event originator mismatch — dropping', {
              clientName: ws.data.clientName,
              claimed: msg.originatorServerId,
              actual: ws.data.serverId,
            });
            return;
          }
          hub.forward(ws, msg);
          break;

        case 'ping':
          hub.send(ws, { kind: 'pong' });
          break;

        case 'pong':
          // No-op: we only need to know the connection is alive, Bun handles that.
          break;
      }
    },

    close(ws) {
      hub.unregister(ws);
      log('info', 'client disconnected', {
        clientName: ws.data.clientName,
        serverId: ws.data.serverId,
      });
    },
  },
});

log('info', 'Fleex event hub listening', {
  port: PORT,
  clientsFile: CLIENTS_FILE,
  authorizedClients: clientsStore.count(),
});
if (clientsStore.count() === 0) {
  log('warn', 'no authorized clients yet — provision one with: fleex hub client add <name>');
}

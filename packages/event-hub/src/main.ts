import type { HubMessage } from '@fleex/shared';
import { Hub, type HubClientData } from './hub';

const PORT = parseInt(process.env['FLEEX_EVENT_HUB_PORT'] ?? '3002', 10);
const EXPECTED_TOKEN = process.env['FLEEX_EVENT_HUB_TOKEN'] ?? '';

const hub = new Hub();

function log(level: 'info' | 'warn' | 'error', msg: string, ctx?: Record<string, unknown>): void {
  const stamp = new Date().toISOString();
  const suffix = ctx ? ' ' + JSON.stringify(ctx) : '';
  process.stdout.write(`[${stamp}] [${level}] ${msg}${suffix}\n`);
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
        ...stats,
        uptimeMs: Date.now() - stats.startedAt,
      });
    }

    if (url.pathname === '/events') {
      if (EXPECTED_TOKEN) {
        const token = url.searchParams.get('token') ?? '';
        if (token !== EXPECTED_TOKEN) {
          return new Response('Unauthorized', { status: 401 });
        }
      }
      const ok = server.upgrade(req, {
        data: {
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
      log('info', 'client connected');
    },

    message(ws, raw) {
      let msg: HubMessage;
      try {
        msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
      } catch {
        log('warn', 'invalid message (not JSON)');
        return;
      }

      switch (msg.kind) {
        case 'hello':
          ws.data.serverId = msg.serverId;
          ws.data.pid = msg.pid;
          ws.data.hostname = msg.hostname;
          log('info', 'hello', { serverId: msg.serverId, pid: msg.pid, hostname: msg.hostname, version: msg.version });
          break;

        case 'event':
          if (!ws.data.serverId) {
            log('warn', 'event received before hello — dropping');
            return;
          }
          if (msg.originatorServerId !== ws.data.serverId) {
            log('warn', 'event originator mismatch — dropping', {
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
      log('info', 'client disconnected', { serverId: ws.data.serverId });
    },
  },
});

log('info', `Fleex event hub listening`, { port: PORT, authRequired: Boolean(EXPECTED_TOKEN) });

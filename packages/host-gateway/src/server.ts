import { homedir } from 'node:os';

import { handleExec, type ExecRequest } from './exec';
import { handleFs, type FsRequest } from './fs';
import { logError } from './logger';
import { handlePtyMessage, handlePtyOpen, handlePtyClose, type PtyWsData } from './pty';

import type { TokenStore } from './auth';
import type { Server, ServerWebSocket } from 'bun';

export interface GatewayOptions {
  port: number;
  hostname: string;
  tokenStore: TokenStore;
}

const BEARER_RE = /^Bearer\s+(.+)$/i;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization');
  if (!header) return null;
  const match = BEARER_RE.exec(header.trim());
  const token = match?.[1]?.trim();
  return token ? token : null;
}

/**
 * HTTP + WebSocket server for the host gateway.
 *
 * Requests are filtered in this order:
 *
 *  1. Any request carrying an `Origin` header is rejected. The only legitimate
 *     client is a Node process, which never sends one; a browser always does,
 *     including on the WebSocket handshake. This is what closes the
 *     `ws://localhost:3001/pty` hole, since a page cannot set `Authorization`
 *     on a WebSocket at all.
 *  2. `GET /health` answers unauthenticated, but only with `{ ok: true }`.
 *  3. Everything else requires a valid bearer token. This is default-deny on
 *     purpose: a route added later is authenticated without touching this file.
 */
export function createGatewayServer(opts: GatewayOptions): Server<PtyWsData> {
  const { port, hostname, tokenStore } = opts;
  const liveSockets = new Set<ServerWebSocket<PtyWsData>>();

  const server = Bun.serve<PtyWsData>({
    port,
    hostname,

    async fetch(req, srv) {
      const url = new URL(req.url);

      if (req.headers.get('origin') !== null) {
        return Response.json({ error: 'forbidden_origin' }, { status: 403 });
      }

      const token = extractBearerToken(req);
      const authenticated = token !== null && tokenStore.verify(token);

      // Health check — public so that `fleex start` and `fleex doctor` can
      // probe the gateway before they hold a token. Host details are only
      // disclosed to authenticated callers.
      if (url.pathname === '/health' && req.method === 'GET') {
        return authenticated
          ? Response.json({ ok: true, authenticated: true, homedir: homedir(), port, hostname })
          : Response.json({ ok: true });
      }

      if (token === null || !authenticated) {
        logError(
          `[auth] rejected ${req.method} ${url.pathname} from ${srv.requestIP(req)?.address ?? 'unknown'}`,
        );
        return Response.json(
          { error: 'unauthorized' },
          { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
        );
      }

      // WebSocket upgrade for /pty. The token is kept on the socket so a
      // rotation or revocation can tear down sessions that are already open.
      if (url.pathname === '/pty') {
        const ok = srv.upgrade(req, {
          data: { initialized: false, proc: null, terminal: null, authToken: token },
        });
        return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
      }

      // Command execution
      if (url.pathname === '/exec' && req.method === 'POST') {
        try {
          const body = (await req.json()) as ExecRequest;
          const result = await handleExec(body);
          return Response.json(result);
        } catch (err) {
          return Response.json({ error: errorMessage(err) }, { status: 500 });
        }
      }

      // Filesystem operations
      if (url.pathname === '/fs' && req.method === 'POST') {
        try {
          const body = (await req.json()) as FsRequest;
          const result = await handleFs(body);
          return Response.json(result);
        } catch (err) {
          return Response.json({ error: errorMessage(err) }, { status: 500 });
        }
      }

      return new Response('Not Found', { status: 404 });
    },

    websocket: {
      open(ws) {
        liveSockets.add(ws);
        handlePtyOpen(ws);
      },
      message(ws, message) {
        handlePtyMessage(ws, message);
      },
      close(ws) {
        liveSockets.delete(ws);
        handlePtyClose(ws);
      },
    },
  });

  // Revocation: `rm ~/.fleex/gateway.token` must not leave live terminals
  // attached to the host.
  tokenStore.startWatch(() => {
    for (const ws of liveSockets) {
      if (!tokenStore.verify(ws.data.authToken)) ws.close(4401, 'token revoked');
    }
  });

  return server;
}

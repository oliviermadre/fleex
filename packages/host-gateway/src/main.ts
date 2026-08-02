import { homedir } from 'node:os';
import { handleExec } from './exec';
import { handleFs } from './fs';
import { handlePtyMessage, handlePtyOpen, handlePtyClose } from './pty';
import { logAlways, getVerbosity } from './logger';

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);
// /exec, /fs and /pty are unauthenticated: binding anywhere but the loopback
// hands arbitrary code execution to the whole network.
const HOST = process.env['GATEWAY_HOST'] ?? '127.0.0.1';

// ── HTTP + WebSocket server ──

interface PtyWsData {
  initialized: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: any;
}

Bun.serve<PtyWsData>({
  port: PORT,
  hostname: HOST,

  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /pty
    if (url.pathname === '/pty') {
      const ok = server.upgrade(req, {
        data: { initialized: false, proc: null, terminal: null },
      });
      return ok ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
    }

    // Health check
    if (url.pathname === '/health' && req.method === 'GET') {
      return Response.json({
        ok: true,
        homedir: homedir(),
      });
    }

    // Command execution
    if (url.pathname === '/exec' && req.method === 'POST') {
      try {
        const body = await req.json();
        const result = await handleExec(body);
        return Response.json(result);
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // Filesystem operations
    if (url.pathname === '/fs' && req.method === 'POST') {
      try {
        const body = await req.json();
        const result = await handleFs(body);
        return Response.json(result);
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    return new Response('Not Found', { status: 404 });
  },

  websocket: {
    open(ws) {
      handlePtyOpen(ws);
    },
    message(ws, message) {
      handlePtyMessage(ws, message);
    },
    close(ws) {
      handlePtyClose(ws);
    },
  },
});

const verbLabel = getVerbosity() >= 2 ? ' (debug)' : getVerbosity() >= 1 ? ' (verbose)' : '';
if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
  logAlways(
    `WARNING: host gateway is listening on ${HOST} — /exec, /fs and /pty are unauthenticated ` +
      'and now reachable from your network.',
  );
}
logAlways(`Host gateway listening on http://${HOST}:${PORT}${verbLabel}`);

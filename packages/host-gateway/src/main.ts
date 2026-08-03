import { homedir } from 'node:os';
import { handleExec } from './exec';
import { handleFs } from './fs';
import { handlePtyMessage, handlePtyOpen, handlePtyClose } from './pty';
import { logAlways, getVerbosity } from './logger';
import { ValidationError } from './validation';

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);

// ── HTTP + WebSocket server ──

interface PtyWsData {
  initialized: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: any;
}

/** A malformed body is the caller's fault (400); anything else is ours (500). */
function errorResponse(err: any): Response {
  const status = err instanceof ValidationError ? 400 : 500;
  return Response.json({ error: err.message }, { status });
}

Bun.serve<PtyWsData>({
  port: PORT,

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
        return errorResponse(err);
      }
    }

    // Filesystem operations
    if (url.pathname === '/fs' && req.method === 'POST') {
      try {
        const body = await req.json();
        const result = await handleFs(body);
        return Response.json(result);
      } catch (err: any) {
        return errorResponse(err);
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
logAlways(`Host gateway listening on http://localhost:${PORT}${verbLabel}`);

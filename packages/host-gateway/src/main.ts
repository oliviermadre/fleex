import { homedir } from 'node:os';
import { handleExec } from './exec';
import { killExec, streamExecResponse } from './exec-stream';
import { handleFs } from './fs';
import { handlePtyMessage, handlePtyOpen, handlePtyClose } from './pty';
import { logAlways, getVerbosity } from './logger';

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);

// ── HTTP + WebSocket server ──

interface PtyWsData {
  initialized: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: any;
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
      // The response only comes once the command exits — an action may wait
      // minutes on a browser login. Bun's default 10 s idle timeout would drop
      // the connection first; the command's own `timeout` bounds it instead.
      server.timeout(req, 0);
      try {
        const body = await req.json();
        const result = await handleExec(body);
        return Response.json(result);
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    // Streaming exec for actions: live output, stoppable (whole process group).
    if (url.pathname === '/exec/stream' && req.method === 'POST') {
      server.timeout(req, 0);
      try {
        const body = await req.json();
        if (!body?.command || typeof body.command !== 'string') {
          return Response.json({ error: 'command is required' }, { status: 400 });
        }
        return streamExecResponse({ command: body.command, cwd: body.cwd, timeout: body.timeout });
      } catch (err: any) {
        return Response.json({ error: err.message }, { status: 500 });
      }
    }

    if (url.pathname === '/exec/kill' && req.method === 'POST') {
      try {
        const body = await req.json();
        return Response.json({ killed: killExec(String(body?.execId ?? '')) });
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
logAlways(`Host gateway listening on http://localhost:${PORT}${verbLabel}`);

import { homedir } from 'node:os';
import { handleExec } from './exec';
import { handleFs } from './fs';
import { handlePtyMessage, handlePtyOpen, handlePtyClose } from './pty';
import { logAlways, getVerbosity } from './logger';

const PORT = parseInt(process.env['GATEWAY_PORT'] ?? '3001', 10);

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
      return Response.json({ ok: true, homedir: homedir() });
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

    // SSE event stream proxy — proxies /events/stream to the ASM server
    if (url.pathname === '/events/stream' && req.method === 'GET') {
      const asmUrl = process.env['ASM_SERVER_URL'] ?? 'http://localhost:3000';
      const targetUrl = new URL('/api/events/stream', asmUrl);
      // Forward query params (filter, lastEventId)
      url.searchParams.forEach((value, key) => {
        targetUrl.searchParams.set(key, value);
      });
      // Forward Last-Event-ID header
      const lastEventId = req.headers.get('Last-Event-ID');
      const headers: Record<string, string> = {};
      if (lastEventId) {
        headers['Last-Event-ID'] = lastEventId;
      }

      try {
        const upstream = await fetch(targetUrl.toString(), { headers });
        if (!upstream.ok || !upstream.body) {
          return new Response('SSE upstream unavailable', { status: 502 });
        }
        return new Response(upstream.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          },
        });
      } catch {
        return new Response('SSE upstream connection failed', { status: 502 });
      }
    }

    // SSE event catalog proxy
    if (url.pathname === '/events/catalog' && req.method === 'GET') {
      const asmUrl = process.env['ASM_SERVER_URL'] ?? 'http://localhost:3000';
      try {
        const upstream = await fetch(new URL('/api/events/catalog', asmUrl).toString());
        if (!upstream.ok) {
          return new Response('Catalog unavailable', { status: 502 });
        }
        return Response.json(await upstream.json());
      } catch {
        return new Response('Catalog upstream connection failed', { status: 502 });
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

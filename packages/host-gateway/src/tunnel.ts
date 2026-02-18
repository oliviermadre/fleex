/**
 * WebSocket reverse tunnel client.
 *
 * Connects outbound to the central server and handles proxied requests:
 *   Central → { id, method, path, body }
 *   Gateway → { id, status, body }
 *
 * Automatically reconnects with exponential backoff.
 */

import { handleExec } from './exec';
import { handleFs } from './fs';

interface TunnelRequest {
  id: string;
  method: string;
  path: string;
  body?: unknown;
}

interface TunnelResponse {
  id: string;
  status: number;
  body?: unknown;
  error?: string;
}

const INITIAL_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 60_000;

export function startTunnel(centralUrl: string, gatewayId: string, secret: string): void {
  let reconnectMs = INITIAL_RECONNECT_MS;

  function connect() {
    const wsUrl = centralUrl.replace(/^http/, 'ws') +
      `/ws/gateway-tunnel?id=${encodeURIComponent(gatewayId)}&secret=${encodeURIComponent(secret)}`;

    console.log(`[tunnel] Connecting to ${centralUrl}...`);
    const ws = new WebSocket(wsUrl);

    ws.addEventListener('open', () => {
      console.log('[tunnel] Connected to central server');
      reconnectMs = INITIAL_RECONNECT_MS;
    });

    ws.addEventListener('message', async (event) => {
      try {
        const req = JSON.parse(String(event.data)) as TunnelRequest;
        const response = await handleTunnelRequest(req);
        ws.send(JSON.stringify(response));
      } catch (err) {
        console.error('[tunnel] Failed to handle request:', err);
      }
    });

    ws.addEventListener('close', () => {
      console.log(`[tunnel] Disconnected. Reconnecting in ${reconnectMs}ms...`);
      setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
    });

    ws.addEventListener('error', (err) => {
      console.error('[tunnel] WebSocket error:', err);
    });
  }

  connect();
}

async function handleTunnelRequest(req: TunnelRequest): Promise<TunnelResponse> {
  try {
    const { path, body } = req;

    if (path === '/exec') {
      const result = await handleExec(body as any);
      return { id: req.id, status: 200, body: result };
    }

    if (path === '/fs') {
      const result = await handleFs(body as any);
      return { id: req.id, status: 200, body: result };
    }

    if (path === '/health') {
      return {
        id: req.id,
        status: 200,
        body: { ok: true },
      };
    }

    return { id: req.id, status: 404, error: `Unknown path: ${path}` };
  } catch (err: any) {
    return { id: req.id, status: 500, error: err.message };
  }
}

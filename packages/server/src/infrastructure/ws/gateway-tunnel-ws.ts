import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { Container } from '../container.js';

/**
 * WebSocket-based reverse tunnel for gateways behind NAT/firewalls.
 *
 * Protocol:
 * 1. Gateway connects to wss://central/ws/gateway-tunnel?id=<gatewayId>&secret=<secret>
 * 2. Central authenticates the gateway.
 * 3. Central can send requests through the tunnel:
 *    → { id: requestId, method: 'POST', path: '/exec', body: {...} }
 *    ← { id: requestId, status: 200, body: {...} }
 * 4. For PTY, a sub-protocol upgrades a specific requestId to binary streaming.
 *
 * This module manages the tunnel connections and provides a way for the
 * server's remote adapters to route requests through tunnels.
 */

interface PendingRequest {
  resolve: (response: TunnelResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

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

class GatewayTunnel {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    public readonly gatewayId: string,
    private readonly ws: WebSocket,
  ) {
    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(String(data)) as TunnelResponse;
        const req = this.pending.get(msg.id);
        if (req) {
          clearTimeout(req.timeout);
          this.pending.delete(msg.id);
          req.resolve(msg);
        }
      } catch {
        // Ignore malformed responses
      }
    });

    ws.on('close', () => {
      for (const [id, req] of this.pending) {
        clearTimeout(req.timeout);
        req.reject(new Error('Tunnel closed'));
      }
      this.pending.clear();
    });
  }

  get isAlive(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  async send(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<TunnelResponse> {
    const id = randomUUID();
    const request: TunnelRequest = { id, method, path, body };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tunnel request timeout: ${method} ${path}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(JSON.stringify(request));
    });
  }

  close(): void {
    this.ws.close();
  }
}

/** Registry of active tunnel connections, keyed by gatewayId. */
const tunnels = new Map<string, GatewayTunnel>();

export function getTunnel(gatewayId: string): GatewayTunnel | null {
  const tunnel = tunnels.get(gatewayId);
  if (tunnel && tunnel.isAlive) return tunnel;
  tunnels.delete(gatewayId);
  return null;
}

export function gatewayTunnelWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    const { gatewayStore, logger } = container;

    app.get('/ws/gateway-tunnel', { websocket: true }, (socket, req) => {
      const url = new URL(req.url, 'http://localhost');
      const gatewayId = url.searchParams.get('id');
      const secret = url.searchParams.get('secret');

      if (!gatewayId || !secret) {
        logger.warn('Tunnel connection rejected: missing id or secret');
        socket.close(4001, 'Missing id or secret');
        return;
      }

      // Register tunnel
      const tunnel = new GatewayTunnel(gatewayId, socket);
      tunnels.set(gatewayId, tunnel);
      logger.info('Gateway tunnel established', { gatewayId });

      // Mark gateway online
      if (gatewayStore) {
        gatewayStore.heartbeat(gatewayId).catch(() => {});
      }

      socket.on('close', () => {
        tunnels.delete(gatewayId);
        logger.info('Gateway tunnel closed', { gatewayId });
        if (gatewayStore) {
          gatewayStore.markOffline(gatewayId).catch(() => {});
        }
      });

      // Periodic heartbeat while tunnel is open
      const heartbeatInterval = setInterval(() => {
        if (socket.readyState !== socket.OPEN) {
          clearInterval(heartbeatInterval);
          return;
        }
        socket.ping();
        if (gatewayStore) {
          gatewayStore.heartbeat(gatewayId).catch(() => {});
        }
      }, 30_000);

      socket.on('close', () => clearInterval(heartbeatInterval));
    });
  };
}

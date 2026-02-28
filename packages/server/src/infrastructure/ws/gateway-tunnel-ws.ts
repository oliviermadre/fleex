import { randomUUID, createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { PtyHandle, TerminalDimensions } from '@asm/shared';
import type { Container } from '../container.js';
import {
  TunnelFrame,
  encodeJsonFrame,
  encodePtyDataFrame,
  encodePtyCtrlFrame,
  parseFrameType,
  parseJsonPayload,
  parsePtyDataPayload,
  parsePtyCtrlPayload,
} from '@asm/shared';
import type {
  TunnelRequest,
  TunnelResponse,
  TunnelAuthMessage,
  PtyControlMessage,
} from '@asm/shared';

/**
 * WebSocket-based reverse tunnel for gateways.
 *
 * Single authenticated channel carrying JSON requests/responses
 * and multiplexed binary PTY streams.
 *
 * Auth flow:
 * 1. Gateway connects with ?id=<gatewayId> (no secret in URL).
 * 2. Gateway sends first message: { type: "auth", secret, name, hostname }
 * 3. Server validates SHA256(secret), registers gateway, replies { type: "auth_ok" }.
 * 4. All subsequent traffic uses the binary frame protocol.
 */

// ── Pending JSON request tracking ─────────────────────────────────

interface PendingRequest {
  resolve: (response: TunnelResponse) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

// ── PTY channel tracking (server side) ────────────────────────────

interface PtyChannel {
  dataCallbacks: Array<(data: Uint8Array) => void>;
  exitCallbacks: Array<(exitCode: number, signal: number) => void>;
  alive: boolean;
}

// ── Auth timeout ──────────────────────────────────────────────────

const AUTH_TIMEOUT_MS = 5_000;

// ── GatewayTunnel class ───────────────────────────────────────────

export class GatewayTunnel {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly ptyChannels = new Map<number, PtyChannel>();
  private nextChannelId = 1;

  constructor(
    public readonly gatewayId: string,
    public readonly userId: string,
    private readonly ws: WebSocket,
  ) {
    ws.on('message', (data: Buffer) => {
      this.handleMessage(data);
    });

    ws.on('close', () => {
      // Reject all pending requests
      for (const [, req] of this.pending) {
        clearTimeout(req.timeout);
        req.reject(new Error('Tunnel closed'));
      }
      this.pending.clear();

      // Notify all PTY channels
      for (const [, ch] of this.ptyChannels) {
        if (ch.alive) {
          ch.alive = false;
          for (const cb of ch.exitCallbacks) cb(1, 0);
        }
      }
      this.ptyChannels.clear();
    });
  }

  get isAlive(): boolean {
    return this.ws.readyState === this.ws.OPEN;
  }

  // ── JSON request/response ──

  async send(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<TunnelResponse> {
    const id = randomUUID();
    const request: TunnelRequest = { id, method, path, body };

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Tunnel request timeout: ${method} ${path}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws.send(encodeJsonFrame(request));
    });
  }

  // ── PTY channel management ──

  openPty(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle {
    const channelId = this.nextChannelId++;
    const channel: PtyChannel = {
      dataCallbacks: [],
      exitCallbacks: [],
      alive: true,
    };
    this.ptyChannels.set(channelId, channel);

    // Send open command to gateway
    this.ws.send(encodePtyCtrlFrame({
      channelId,
      action: 'open',
      tmuxSessionName,
      cols: dims.cols,
      rows: dims.rows,
    }));

    const tunnel = this;

    return {
      write(data: string) {
        if (channel.alive && tunnel.ws.readyState === tunnel.ws.OPEN) {
          tunnel.ws.send(encodePtyDataFrame(channelId, Buffer.from(data, 'utf-8')));
        }
      },
      resize(d: TerminalDimensions) {
        if (channel.alive && tunnel.ws.readyState === tunnel.ws.OPEN) {
          tunnel.ws.send(encodePtyCtrlFrame({
            channelId,
            action: 'resize',
            cols: d.cols,
            rows: d.rows,
          }));
        }
      },
      onData(cb: (data: Uint8Array) => void) {
        channel.dataCallbacks.push(cb);
      },
      onExit(cb: (exitCode: number, signal: number) => void) {
        channel.exitCallbacks.push(cb);
      },
      kill() {
        if (channel.alive) {
          channel.alive = false;
          tunnel.ptyChannels.delete(channelId);
          if (tunnel.ws.readyState === tunnel.ws.OPEN) {
            tunnel.ws.send(encodePtyCtrlFrame({ channelId, action: 'close' }));
          }
        }
      },
      get isAlive() {
        return channel.alive;
      },
    };
  }

  close(): void {
    this.ws.close();
  }

  // ── Internal message dispatch ──

  private handleMessage(raw: Buffer): void {
    const frameType = parseFrameType(raw);
    if (frameType === null) return;

    // JSON frame — tunnel response
    if (frameType === TunnelFrame.JSON) {
      try {
        const msg = parseJsonPayload<TunnelResponse>(raw);
        const req = this.pending.get(msg.id);
        if (req) {
          clearTimeout(req.timeout);
          this.pending.delete(msg.id);
          req.resolve(msg);
        }
      } catch {
        // Ignore malformed
      }
      return;
    }

    // PTY data frame
    if (frameType === TunnelFrame.PTY_DATA) {
      const { channelId, payload } = parsePtyDataPayload(raw);
      const ch = this.ptyChannels.get(channelId);
      if (ch?.alive) {
        for (const cb of ch.dataCallbacks) cb(payload);
      }
      return;
    }

    // PTY control frame
    if (frameType === TunnelFrame.PTY_CTRL) {
      try {
        const ctrl = parsePtyCtrlPayload(raw);
        const ch = this.ptyChannels.get(ctrl.channelId);
        if (!ch) return;

        switch (ctrl.action) {
          case 'opened':
            // Gateway confirmed the PTY is open — nothing to do
            break;
          case 'exit':
            if (ch.alive) {
              ch.alive = false;
              this.ptyChannels.delete(ctrl.channelId);
              for (const cb of ch.exitCallbacks) cb(ctrl.exitCode, 0);
            }
            break;
          case 'error':
            if (ch.alive) {
              ch.alive = false;
              this.ptyChannels.delete(ctrl.channelId);
              for (const cb of ch.exitCallbacks) cb(1, 0);
            }
            break;
        }
      } catch {
        // Ignore malformed
      }
      return;
    }
  }
}

// ── Tunnel registry ───────────────────────────────────────────────
//
// Keyed by gatewayId. Each tunnel stores its owning userId so lookups
// can be scoped per user, preventing cross-user access.

const tunnels = new Map<string, GatewayTunnel>();

export function getTunnel(gatewayId: string): GatewayTunnel | null {
  const tunnel = tunnels.get(gatewayId);
  if (tunnel && tunnel.isAlive) return tunnel;
  tunnels.delete(gatewayId);
  return null;
}

/**
 * Get a connected tunnel belonging to a specific user.
 * Returns the first alive tunnel owned by userId, or null.
 * This is the ONLY function that should be used for request routing.
 */
export function getTunnelForUser(userId: string): GatewayTunnel | null {
  for (const [id, tunnel] of tunnels) {
    if (!tunnel.isAlive) {
      tunnels.delete(id);
      continue;
    }
    if (tunnel.userId === userId) return tunnel;
  }
  return null;
}

// ── Fastify plugin ────────────────────────────────────────────────

const REGISTRATION_TOKEN = process.env['GATEWAY_REGISTRATION_TOKEN'] ?? null;

export function gatewayTunnelWsPlugin(container: Container) {
  return async function (app: FastifyInstance) {
    const { gatewayStore, logger } = container;

    app.get('/ws/gateway-tunnel', { websocket: true }, async (socket, req) => {
      const url = new URL(req.url, 'http://localhost');
      const gatewayId = url.searchParams.get('id');

      if (!gatewayId) {
        logger.warn('Tunnel connection rejected: missing id');
        socket.close(4001, 'Missing id');
        return;
      }

      // ── Auth handshake: expect first message within AUTH_TIMEOUT_MS ──

      let authenticated = false;

      const authTimeout = setTimeout(() => {
        if (!authenticated) {
          logger.warn('Tunnel auth timeout', { gatewayId });
          socket.close(4003, 'Authentication timeout');
        }
      }, AUTH_TIMEOUT_MS);

      // We need to handle the first message specially for auth
      const onFirstMessage = async (data: Buffer) => {
        clearTimeout(authTimeout);

        try {
          // First message must be a JSON frame with auth
          const frameType = parseFrameType(data);
          if (frameType !== TunnelFrame.JSON) {
            logger.warn('Tunnel auth: expected JSON frame', { gatewayId });
            socket.close(4003, 'Expected auth message');
            return;
          }

          const msg = parseJsonPayload<TunnelAuthMessage>(data);
          if (msg.type !== 'auth' || !msg.secret) {
            logger.warn('Tunnel auth: invalid auth message', { gatewayId });
            socket.close(4003, 'Invalid auth message');
            return;
          }

          // Validate secret — verifySecret returns the owning userId or null
          const secretHash = createHash('sha256').update(msg.secret).digest('hex');
          let ownerUserId: string | null = null;

          if (gatewayStore) {
            ownerUserId = await gatewayStore.verifySecret(gatewayId, secretHash);
            if (!ownerUserId) {
              // Gateway not registered or secret mismatch
              logger.warn('Tunnel auth rejected: invalid credentials', { gatewayId });
              socket.send(encodeJsonFrame({ type: 'auth_error', reason: 'Invalid credentials' }));
              socket.close(4003, 'Invalid credentials');
              return;
            }
          } else {
            // No gateway store (single-user/no-db mode) — assign default user
            ownerUserId = '00000000-0000-0000-0000-000000000000';
          }

          // Auth OK
          authenticated = true;
          socket.send(encodeJsonFrame({ type: 'auth_ok' }));

          // Remove the one-shot auth listener and install the tunnel
          socket.removeListener('message', onFirstMessage);

          const tunnel = new GatewayTunnel(gatewayId, ownerUserId, socket);
          tunnels.set(gatewayId, tunnel);
          logger.info('Gateway tunnel established', { gatewayId, userId: ownerUserId });

          // Mark gateway online
          if (gatewayStore) {
            gatewayStore.heartbeat(gatewayId).catch(() => {});
          }

          // Periodic heartbeat
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

          socket.on('close', () => {
            clearInterval(heartbeatInterval);
            tunnels.delete(gatewayId);
            logger.info('Gateway tunnel closed', { gatewayId });
            if (gatewayStore) {
              gatewayStore.markOffline(gatewayId).catch(() => {});
            }
          });
        } catch (err) {
          logger.error('Tunnel auth error', {
            gatewayId,
            error: err instanceof Error ? err.message : String(err),
          });
          socket.close(4003, 'Authentication failed');
        }
      };

      socket.on('message', onFirstMessage);
    });
  };
}

import { randomUUID, randomBytes } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  TunnelMsgType,
  TUNNEL_CONTROL_CHANNEL,
  TUNNEL_PING_INTERVAL_MS,
  TUNNEL_PONG_TIMEOUT_MS,
  encodeTunnelJson,
  encodeTunnelRaw,
  encodeTunnelEmpty,
  decodeTunnelFrame,
  parseTunnelJson,
  type TunnelChallengePayload,
  type TunnelHelloPayload,
  type TunnelExecReqPayload,
  type TunnelExecResPayload,
  type TunnelFsReqPayload,
  type TunnelFsResPayload,
  type TunnelPtyOpenPayload,
  type TunnelPtyOpenedPayload,
  type TunnelPtyExitPayload,
  type TunnelPtyErrorPayload,
} from '@fleex/shared';
import { verify, createPublicKey } from 'node:crypto';
import type { Gateway } from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export interface GatewayStorePort {
  getById(id: string): Promise<Gateway | null>;
  updateStatus(id: string, status: 'online' | 'offline'): Promise<void>;
}

function verifyEd25519(publicKeyHex: string, challengeHex: string, signatureHex: string): boolean {
  const challenge = Buffer.from(challengeHex, 'hex');
  const signature = Buffer.from(signatureHex, 'hex');
  const pubRaw = Buffer.from(publicKeyHex, 'hex');
  const spkiPrefix = Buffer.from('302a300506032b6570032100', 'hex');
  const spkiDer = Buffer.concat([spkiPrefix, pubRaw]);
  const keyObject = createPublicKey({ key: spkiDer, format: 'der', type: 'spki' });
  return verify(null, challenge, keyObject, signature);
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ConnectedGateway {
  gatewayId: string;
  ws: WebSocket;
  pendingRequests: Map<string, PendingRequest>;
  nextPtyChannel: number;
  ptyDataCallbacks: Map<number, (data: Buffer) => void>;
  ptyExitCallbacks: Map<number, (exitCode: number) => void>;
  pingTimer: ReturnType<typeof setInterval> | null;
  pongTimer: ReturnType<typeof setTimeout> | null;
}

export class GatewayTunnelManager {
  private readonly gateways = new Map<string, ConnectedGateway>();
  // Default gateway (first connected, or only one) for backward compat
  private defaultGatewayId: string | null = null;

  constructor(
    private readonly gatewayStore: GatewayStorePort | null,
    private readonly logger: LoggerPort,
  ) {}

  get hasConnectedGateway(): boolean {
    return this.gateways.size > 0;
  }

  get connectedGatewayIds(): string[] {
    return Array.from(this.gateways.keys());
  }

  getDefaultGateway(): ConnectedGateway | null {
    if (!this.defaultGatewayId) return null;
    return this.gateways.get(this.defaultGatewayId) ?? null;
  }

  getGateway(gatewayId: string): ConnectedGateway | null {
    return this.gateways.get(gatewayId) ?? null;
  }

  async handleNewConnection(ws: WebSocket): Promise<void> {
    // Step 1: Send challenge
    const challenge = randomBytes(32).toString('hex');
    const challengeFrame = encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.CHALLENGE, {
      challenge,
    } satisfies TunnelChallengePayload);
    ws.send(challengeFrame);

    // Step 2: Wait for HELLO with timeout
    const helloPromise = new Promise<TunnelHelloPayload>((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Handshake timeout'));
      }, 10_000);

      const onMessage = (data: Buffer) => {
        try {
          const frame = decodeTunnelFrame(data);
          if (frame.msgType === TunnelMsgType.HELLO) {
            cleanup();
            resolve(parseTunnelJson<TunnelHelloPayload>(frame.payload));
          }
        } catch {
          // Wait for valid HELLO
        }
      };

      const cleanup = () => {
        clearTimeout(timeout);
        ws.removeListener('message', onMessage);
      };

      ws.on('message', onMessage);
    });

    let hello: TunnelHelloPayload;
    try {
      hello = await helloPromise;
    } catch (err) {
      this.logger.warn('Gateway handshake failed', { error: String(err) });
      ws.close();
      return;
    }

    // Step 3: Verify signature
    if (!this.gatewayStore) {
      this.logger.warn('Tunnel connection rejected: gateway auth requires a database');
      const errorFrame = encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.ERROR, {
        message: 'Gateway tunnel requires database-backed auth',
      });
      ws.send(errorFrame);
      ws.close();
      return;
    }

    const gw = await this.gatewayStore.getById(hello.gatewayId);
    if (!gw || !gw.publicKey) {
      this.logger.warn('Unknown gateway or missing public key', { gatewayId: hello.gatewayId });
      const errorFrame = encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.ERROR, { message: 'Unknown gateway' });
      ws.send(errorFrame);
      ws.close();
      return;
    }

    const valid = verifyEd25519(gw.publicKey, challenge, hello.signature);
    if (!valid) {
      this.logger.warn('Invalid signature from gateway', { gatewayId: hello.gatewayId });
      const errorFrame = encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.ERROR, { message: 'Invalid signature' });
      ws.send(errorFrame);
      ws.close();
      return;
    }

    await this.gatewayStore.updateStatus(hello.gatewayId, 'online');

    // Step 4: Send HELLO_ACK
    const ackFrame = encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.HELLO_ACK, { ok: true });
    ws.send(ackFrame);

    // Step 5: Register gateway (close stale connection if reconnecting)
    const existing = this.gateways.get(hello.gatewayId);
    if (existing) {
      this.logger.info('Gateway reconnecting, closing stale connection', { gatewayId: hello.gatewayId });
      if (existing.pingTimer) clearInterval(existing.pingTimer);
      if (existing.pongTimer) clearTimeout(existing.pongTimer);
      for (const [, pending] of existing.pendingRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Gateway reconnected'));
      }
      existing.pendingRequests.clear();
      for (const [, cb] of existing.ptyExitCallbacks) {
        cb(1);
      }
      existing.ptyDataCallbacks.clear();
      existing.ptyExitCallbacks.clear();
      existing.ws.close();
    }

    const connected: ConnectedGateway = {
      gatewayId: hello.gatewayId,
      ws,
      pendingRequests: new Map(),
      nextPtyChannel: 1,
      ptyDataCallbacks: new Map(),
      ptyExitCallbacks: new Map(),
      pingTimer: null,
      pongTimer: null,
    };

    this.gateways.set(hello.gatewayId, connected);
    if (!this.defaultGatewayId) {
      this.defaultGatewayId = hello.gatewayId;
    }

    this.logger.info('Gateway tunnel connected', { gatewayId: hello.gatewayId, name: hello.name });

    // Setup message handler
    ws.on('message', (data: Buffer) => {
      this.handleMessage(connected, data);
    });

    // Setup ping/pong
    connected.pingTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) {
        ws.send(encodeTunnelEmpty(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.PING));
        connected.pongTimer = setTimeout(() => {
          this.logger.warn('Gateway pong timeout, closing', { gatewayId: hello.gatewayId });
          ws.close();
        }, TUNNEL_PONG_TIMEOUT_MS);
      }
    }, TUNNEL_PING_INTERVAL_MS);

    // Cleanup on close
    ws.on('close', () => {
      this.handleDisconnect(connected);
    });

    ws.on('error', (err) => {
      this.logger.error('Gateway tunnel error', { gatewayId: hello.gatewayId, error: String(err) });
    });
  }

  private handleMessage(gw: ConnectedGateway, raw: Buffer): void {
    try {
      const frame = decodeTunnelFrame(raw);

      switch (frame.msgType) {
        case TunnelMsgType.PONG: {
          if (gw.pongTimer) {
            clearTimeout(gw.pongTimer);
            gw.pongTimer = null;
          }
          break;
        }

        case TunnelMsgType.EXEC_RES: {
          const res = parseTunnelJson<TunnelExecResPayload>(frame.payload);
          const pending = gw.pendingRequests.get(res.reqId);
          if (pending) {
            gw.pendingRequests.delete(res.reqId);
            clearTimeout(pending.timer);
            pending.resolve(res);
          }
          break;
        }

        case TunnelMsgType.FS_RES: {
          const res = parseTunnelJson<TunnelFsResPayload>(frame.payload);
          const pending = gw.pendingRequests.get(res.reqId);
          if (pending) {
            gw.pendingRequests.delete(res.reqId);
            clearTimeout(pending.timer);
            pending.resolve(res);
          }
          break;
        }

        case TunnelMsgType.PTY_OPENED: {
          // channelId > 0 for PTY
          const pending = gw.pendingRequests.get(`pty-open-${frame.channelId}`);
          if (pending) {
            gw.pendingRequests.delete(`pty-open-${frame.channelId}`);
            clearTimeout(pending.timer);
            pending.resolve(true);
          }
          break;
        }

        case TunnelMsgType.PTY_DATA: {
          const cb = gw.ptyDataCallbacks.get(frame.channelId);
          if (cb) {
            cb(Buffer.from(frame.payload));
          }
          break;
        }

        case TunnelMsgType.PTY_EXIT: {
          const exit = parseTunnelJson<TunnelPtyExitPayload>(frame.payload);
          const cb = gw.ptyExitCallbacks.get(frame.channelId);
          if (cb) {
            cb(exit.exitCode);
          }
          gw.ptyDataCallbacks.delete(frame.channelId);
          gw.ptyExitCallbacks.delete(frame.channelId);
          break;
        }

        case TunnelMsgType.PTY_ERROR: {
          const err = parseTunnelJson<TunnelPtyErrorPayload>(frame.payload);
          const pending = gw.pendingRequests.get(`pty-open-${frame.channelId}`);
          if (pending) {
            gw.pendingRequests.delete(`pty-open-${frame.channelId}`);
            clearTimeout(pending.timer);
            pending.reject(new Error(err.message));
          }
          break;
        }
      }
    } catch (err) {
      this.logger.error('Failed to handle tunnel message', { error: String(err) });
    }
  }

  private handleDisconnect(gw: ConnectedGateway): void {
    this.logger.info('Gateway tunnel disconnected', { gatewayId: gw.gatewayId });

    if (gw.pingTimer) clearInterval(gw.pingTimer);
    if (gw.pongTimer) clearTimeout(gw.pongTimer);

    // Reject all pending requests
    for (const [, pending] of gw.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Gateway disconnected'));
    }
    gw.pendingRequests.clear();

    // Notify PTY exit callbacks
    for (const [, cb] of gw.ptyExitCallbacks) {
      cb(1);
    }
    gw.ptyDataCallbacks.clear();
    gw.ptyExitCallbacks.clear();

    this.gateways.delete(gw.gatewayId);

    if (this.defaultGatewayId === gw.gatewayId) {
      const first = this.gateways.keys().next();
      this.defaultGatewayId = first.done ? null : first.value;
    }

    if (this.gatewayStore) {
      this.gatewayStore.updateStatus(gw.gatewayId, 'offline').catch(() => {});
    }
  }

  // ── Request helpers ──

  sendExecRequest(
    gatewayId: string | null,
    payload: Omit<TunnelExecReqPayload, 'reqId'>,
    timeoutMs = 60_000,
  ): Promise<TunnelExecResPayload> {
    const gw = gatewayId ? this.getGateway(gatewayId) : this.getDefaultGateway();
    if (!gw) throw new Error('No gateway connected');

    const reqId = randomUUID();
    const frame = encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.EXEC_REQ, {
      ...payload,
      reqId,
    } satisfies TunnelExecReqPayload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        gw.pendingRequests.delete(reqId);
        reject(new Error('Exec request timeout'));
      }, timeoutMs);
      gw.pendingRequests.set(reqId, { resolve, reject, timer });
      gw.ws.send(frame);
    });
  }

  sendFsRequest(
    gatewayId: string | null,
    payload: Omit<TunnelFsReqPayload, 'reqId'>,
    timeoutMs = 30_000,
  ): Promise<TunnelFsResPayload> {
    const gw = gatewayId ? this.getGateway(gatewayId) : this.getDefaultGateway();
    if (!gw) throw new Error('No gateway connected');

    const reqId = randomUUID();
    const frame = encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.FS_REQ, {
      ...payload,
      reqId,
    } satisfies TunnelFsReqPayload);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        gw.pendingRequests.delete(reqId);
        reject(new Error('FS request timeout'));
      }, timeoutMs);
      gw.pendingRequests.set(reqId, { resolve, reject, timer });
      gw.ws.send(frame);
    });
  }

  openPtyChannel(
    gatewayId: string | null,
    tmuxSessionName: string,
    cols: number,
    rows: number,
  ): {
    channelId: number;
    openPromise: Promise<void>;
    onData: (cb: (data: Buffer) => void) => void;
    onExit: (cb: (exitCode: number) => void) => void;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    close: () => void;
  } {
    const gw = gatewayId ? this.getGateway(gatewayId) : this.getDefaultGateway();
    if (!gw) throw new Error('No gateway connected');

    const channelId = gw.nextPtyChannel++;
    let dataCallback: ((data: Buffer) => void) | null = null;
    let exitCallback: ((exitCode: number) => void) | null = null;

    gw.ptyDataCallbacks.set(channelId, (data) => dataCallback?.(data));
    gw.ptyExitCallbacks.set(channelId, (code) => exitCallback?.(code));

    // Send PTY_OPEN
    const openFrame = encodeTunnelJson(channelId, TunnelMsgType.PTY_OPEN, {
      tmuxSessionName,
      cols,
      rows,
    } satisfies TunnelPtyOpenPayload);
    gw.ws.send(openFrame);

    const openPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        gw.pendingRequests.delete(`pty-open-${channelId}`);
        reject(new Error('PTY open timeout'));
      }, 10_000);
      gw.pendingRequests.set(`pty-open-${channelId}`, {
        resolve: () => resolve(),
        reject,
        timer,
      });
    });

    return {
      channelId,
      openPromise,
      onData(cb) { dataCallback = cb; },
      onExit(cb) { exitCallback = cb; },
      write(data: string) {
        if (gw.ws.readyState === gw.ws.OPEN) {
          gw.ws.send(encodeTunnelRaw(channelId, TunnelMsgType.PTY_DATA, Buffer.from(data, 'utf-8')));
        }
      },
      resize(c: number, r: number) {
        if (gw.ws.readyState === gw.ws.OPEN) {
          gw.ws.send(encodeTunnelJson(channelId, TunnelMsgType.PTY_RESIZE, { cols: c, rows: r }));
        }
      },
      close() {
        if (gw.ws.readyState === gw.ws.OPEN) {
          gw.ws.send(encodeTunnelEmpty(channelId, TunnelMsgType.PTY_CLOSE));
        }
        gw.ptyDataCallbacks.delete(channelId);
        gw.ptyExitCallbacks.delete(channelId);
      },
    };
  }

  shutdown(): void {
    for (const [, gw] of this.gateways) {
      if (gw.pingTimer) clearInterval(gw.pingTimer);
      if (gw.pongTimer) clearTimeout(gw.pongTimer);
      gw.ws.close();
    }
    this.gateways.clear();
    this.defaultGatewayId = null;
  }
}

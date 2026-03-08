// ── Gateway Tunnel Client ──
//
// Establishes a persistent WebSocket connection to the server's
// /ws/gateway-tunnel endpoint. Handles handshake, reconnection,
// and dispatches incoming requests to the appropriate handler.

import { logAlways, logInfo, logError } from './logger';
import type { GatewayIdentity } from './identity';
import { signChallenge } from './identity';

import type {
  TunnelChallengePayload,
  TunnelHelloPayload,
  TunnelHelloAckPayload,
  TunnelExecReqPayload,
  TunnelFsReqPayload,
  TunnelPtyOpenPayload,
  TunnelPtyResizePayload,
} from '@fleex/shared';

// We import from @fleex/shared via the source path since the gateway
// is a Bun project and can resolve TS directly.
import {
  TunnelMsgType,
  TUNNEL_CONTROL_CHANNEL,
  TUNNEL_RECONNECT_INITIAL_MS,
  TUNNEL_RECONNECT_MAX_MS,
  WS_GATEWAY_TUNNEL_PATH,
} from '../../shared/src/types/gateway-tunnel';

import {
  decodeTunnelFrame,
  parseTunnelJson,
  encodeTunnelJson,
  encodeTunnelRaw,
  encodeTunnelEmpty,
} from '../../shared/src/tunnel-codec';

import { handleExec } from './exec';
import { handleFs } from './fs';
import { createTunnelPtyHandler, type TunnelPtyHandler } from './tunnel-pty';

export class TunnelClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = TUNNEL_RECONNECT_INITIAL_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private alive = false;
  private ptyHandler: TunnelPtyHandler | null = null;

  constructor(
    private readonly identity: GatewayIdentity,
  ) {}

  start(): void {
    this.connect();
  }

  stop(): void {
    this.alive = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.ptyHandler) {
      this.ptyHandler.closeAll();
    }
  }

  private connect(): void {
    const wsUrl = this.identity.serverUrl.replace(/^http/, 'ws') + WS_GATEWAY_TUNNEL_PATH;
    logAlways(`Connecting to server tunnel: ${wsUrl}`);

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (err) {
      logError('Failed to create WebSocket:', err);
      this.scheduleReconnect();
      return;
    }

    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      logInfo('WebSocket connected, waiting for challenge...');
      this.reconnectDelay = TUNNEL_RECONNECT_INITIAL_MS;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      const raw = event.data instanceof ArrayBuffer
        ? new Uint8Array(event.data)
        : new Uint8Array(event.data as ArrayBuffer);
      this.handleMessage(raw);
    };

    this.ws.onclose = () => {
      logInfo('WebSocket closed');
      this.alive = false;
      this.scheduleReconnect();
    };

    this.ws.onerror = (event: Event) => {
      logError('WebSocket error:', event);
    };
  }

  private handleMessage(raw: Uint8Array): void {
    try {
      const frame = decodeTunnelFrame(raw);

      switch (frame.msgType) {
        case TunnelMsgType.CHALLENGE: {
          const { challenge } = parseTunnelJson<TunnelChallengePayload>(frame.payload);
          logInfo('Received challenge, signing...');
          const signature = signChallenge(this.identity.privateKeyHex, challenge);
          const hello: TunnelHelloPayload = {
            gatewayId: this.identity.gatewayId,
            signature,
          };
          this.send(encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.HELLO, hello));
          break;
        }

        case TunnelMsgType.HELLO_ACK: {
          logAlways('Tunnel authenticated successfully');
          this.alive = true;
          this.ptyHandler = createTunnelPtyHandler((data) => this.send(data));
          break;
        }

        case TunnelMsgType.ERROR: {
          const { message } = parseTunnelJson<{ message: string }>(frame.payload);
          logError('Server error:', message);
          break;
        }

        case TunnelMsgType.PING: {
          this.send(encodeTunnelEmpty(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.PONG));
          break;
        }

        case TunnelMsgType.EXEC_REQ: {
          const req = parseTunnelJson<TunnelExecReqPayload>(frame.payload);
          this.handleExecReq(req);
          break;
        }

        case TunnelMsgType.FS_REQ: {
          const req = parseTunnelJson<TunnelFsReqPayload>(frame.payload);
          this.handleFsReq(req);
          break;
        }

        case TunnelMsgType.PTY_OPEN: {
          const payload = parseTunnelJson<TunnelPtyOpenPayload>(frame.payload);
          this.ptyHandler?.open(frame.channelId, payload);
          break;
        }

        case TunnelMsgType.PTY_DATA: {
          // Binary data for PTY input
          this.ptyHandler?.write(frame.channelId, frame.payload);
          break;
        }

        case TunnelMsgType.PTY_RESIZE: {
          const payload = parseTunnelJson<TunnelPtyResizePayload>(frame.payload);
          this.ptyHandler?.resize(frame.channelId, payload.cols, payload.rows);
          break;
        }

        case TunnelMsgType.PTY_CLOSE: {
          this.ptyHandler?.close(frame.channelId);
          break;
        }
      }
    } catch (err) {
      logError('Failed to handle message:', err);
    }
  }

  private async handleExecReq(req: TunnelExecReqPayload): Promise<void> {
    try {
      const result = await handleExec({
        command: req.command,
        args: req.args,
        cwd: req.cwd,
        timeout: req.timeout,
        maxBuffer: req.maxBuffer,
        shell: req.shell,
      });
      this.send(encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.EXEC_RES, {
        reqId: req.reqId,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      }));
    } catch (err: any) {
      this.send(encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.EXEC_RES, {
        reqId: req.reqId,
        stdout: '',
        stderr: '',
        exitCode: 1,
        error: err.message,
      }));
    }
  }

  private async handleFsReq(req: TunnelFsReqPayload): Promise<void> {
    try {
      const result = await handleFs({
        op: req.op,
        path: req.path,
        content: req.content,
        bytes: req.bytes,
        recursive: req.recursive,
      } as any);
      this.send(encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.FS_RES, {
        reqId: req.reqId,
        data: result,
      }));
    } catch (err: any) {
      this.send(encodeTunnelJson(TUNNEL_CONTROL_CHANNEL, TunnelMsgType.FS_RES, {
        reqId: req.reqId,
        error: err.message,
      }));
    }
  }

  private send(data: Uint8Array): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(data);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    logInfo(`Reconnecting in ${this.reconnectDelay}ms...`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, TUNNEL_RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay);
  }
}

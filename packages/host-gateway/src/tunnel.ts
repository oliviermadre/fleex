/**
 * WebSocket reverse tunnel client — single authenticated channel.
 *
 * Connects outbound to the central server over a single WebSocket and
 * handles all communication: auth, exec, fs, and multiplexed PTY streams.
 *
 * Wire protocol (binary frames):
 *   0x01 [JSON]       — request/response, auth
 *   0x02 [u32 chId][…]— PTY binary data
 *   0x03 [JSON]       — PTY control (open/resize/exit/close)
 *
 * Auth flow:
 *   1. Gateway connects with only ?id= in the URL (no secret).
 *   2. On open, sends { type: "auth", secret, name, hostname }.
 *   3. Waits for { type: "auth_ok" } before processing requests.
 *
 * Automatically reconnects with exponential backoff.
 */

import { execFileSync } from 'node:child_process';
import { hostname } from 'node:os';
import { handleExec } from './exec';
import { handleFs } from './fs';
import { logInfo, logError } from './logger';
import type {
  TunnelRequest,
  TunnelResponse,
  TunnelAuthMessage,
  PtyControlMessage,
} from '@asm/shared';
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

// ── PTY infrastructure ────────────────────────────────────────────

function resolveTmuxPath(): string {
  try {
    return execFileSync('which', ['tmux'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'tmux';
  }
}

const TMUX_PATH = resolveTmuxPath();

interface PtyChannel {
  proc: ReturnType<typeof Bun.spawn>;
  terminal: any;
}

// ── Tunnel client ─────────────────────────────────────────────────

const INITIAL_RECONNECT_MS = 2_000;
const MAX_RECONNECT_MS = 60_000;

export function startTunnel(
  centralUrl: string,
  gatewayId: string,
  secret: string,
  gatewayName: string,
): void {
  let reconnectMs = INITIAL_RECONNECT_MS;

  function connect() {
    // Enforce TLS for non-localhost connections
    let effectiveUrl = centralUrl;
    const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(centralUrl);
    if (!isLocal && centralUrl.startsWith('http://')) {
      effectiveUrl = centralUrl.replace(/^http:\/\//, 'https://');
      logInfo(`[tunnel] Upgrading to TLS: ${effectiveUrl}`);
    }

    // Only send id in the URL — secret is sent in the auth message
    const wsUrl =
      effectiveUrl.replace(/^http/, 'ws') +
      `/ws/gateway-tunnel?id=${encodeURIComponent(gatewayId)}`;

    logInfo(`[tunnel] Connecting to ${effectiveUrl}...`);
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';

    let authenticated = false;
    const ptyChannels = new Map<number, PtyChannel>();

    // ── Helpers ──

    function sendJsonFrame(msg: unknown): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encodeJsonFrame(msg));
      }
    }

    function sendPtyData(channelId: number, data: Buffer | Uint8Array): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encodePtyDataFrame(channelId, data));
      }
    }

    function sendPtyCtrl(msg: PtyControlMessage): void {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(encodePtyCtrlFrame(msg));
      }
    }

    function cleanupPtyChannel(channelId: number): void {
      const ch = ptyChannels.get(channelId);
      if (!ch) return;
      ptyChannels.delete(channelId);
      try { ch.terminal?.close(); } catch { /* already closed */ }
      try { ch.proc?.kill(); } catch { /* already dead */ }
    }

    // ── PTY open ──

    function handlePtyOpen(msg: PtyControlMessage & { action: 'open' }): void {
      const { channelId, tmuxSessionName, cols, rows } = msg;

      try {
        // Strip TMUX/TMUX_PANE so tmux attach works even when
        // the gateway itself is running inside a tmux session.
        const { TMUX, TMUX_PANE, ...cleanEnv } = process.env;

        const proc = Bun.spawn([TMUX_PATH, 'attach', '-t', tmuxSessionName], {
          cwd: process.cwd(),
          env: cleanEnv as Record<string, string>,
          terminal: {
            cols,
            rows,
            name: 'xterm-256color',
            data(_terminal: any, data: Buffer) {
              sendPtyData(channelId, data);
            },
            exit(_terminal: any) {
              logInfo(`[tunnel/pty] terminal exited for channel ${channelId}`);
            },
          },
        });

        ptyChannels.set(channelId, { proc, terminal: proc.terminal });
        logInfo(`[tunnel/pty] opened channel=${channelId} pid=${proc.pid} tmux="${tmuxSessionName}"`);

        sendPtyCtrl({ channelId, action: 'opened' });

        // Handle process exit
        proc.exited.then((exitCode) => {
          logInfo(`[tunnel/pty] exited channel=${channelId} pid=${proc.pid} exitCode=${exitCode}`);
          sendPtyCtrl({ channelId, action: 'exit', exitCode: exitCode ?? 0 });
          ptyChannels.delete(channelId);
        });
      } catch (err) {
        logError(`[tunnel/pty] spawn failed for channel ${channelId}:`, err);
        sendPtyCtrl({ channelId, action: 'error', message: String(err) });
      }
    }

    // ── WebSocket event handlers ──

    ws.addEventListener('open', () => {
      logInfo('[tunnel] Connected, sending auth...');
      reconnectMs = INITIAL_RECONNECT_MS;

      // Send auth as the first message
      const authMsg: TunnelAuthMessage = {
        type: 'auth',
        secret,
        name: gatewayName,
        hostname: hostname(),
      };
      sendJsonFrame(authMsg);
    });

    ws.addEventListener('message', async (event) => {
      try {
        const raw = event.data instanceof ArrayBuffer
          ? Buffer.from(event.data)
          : Buffer.from(event.data as any);

        const frameType = parseFrameType(raw);
        if (frameType === null) return;

        // ── JSON frame ──
        if (frameType === TunnelFrame.JSON) {
          const msg = parseJsonPayload<any>(raw);

          // Auth response
          if (msg.type === 'auth_ok') {
            authenticated = true;
            logInfo('[tunnel] Authenticated with central server');
            return;
          }
          if (msg.type === 'auth_error') {
            logError(`[tunnel] Auth rejected: ${msg.reason}`);
            ws.close();
            return;
          }

          // Must be authenticated for anything else
          if (!authenticated) return;

          // Tunnel request (exec, fs, health)
          if (msg.id && msg.path) {
            const response = await handleTunnelRequest(msg as TunnelRequest);
            sendJsonFrame(response);
          }
          return;
        }

        // Must be authenticated for binary frames
        if (!authenticated) return;

        // ── PTY data frame ──
        if (frameType === TunnelFrame.PTY_DATA) {
          const { channelId, payload } = parsePtyDataPayload(raw);
          const ch = ptyChannels.get(channelId);
          if (ch?.terminal) {
            ch.terminal.write(payload);
          }
          return;
        }

        // ── PTY control frame ──
        if (frameType === TunnelFrame.PTY_CTRL) {
          const ctrl = parsePtyCtrlPayload(raw);

          switch (ctrl.action) {
            case 'open':
              handlePtyOpen(ctrl as PtyControlMessage & { action: 'open' });
              break;
            case 'resize': {
              const ch = ptyChannels.get(ctrl.channelId);
              if (ch?.terminal && 'cols' in ctrl) {
                ch.terminal.resize(ctrl.cols, ctrl.rows);
              }
              break;
            }
            case 'close':
              cleanupPtyChannel(ctrl.channelId);
              break;
          }
          return;
        }
      } catch (err) {
        logError('[tunnel] Failed to handle message:', err);
      }
    });

    ws.addEventListener('close', () => {
      // Clean up all PTY channels
      for (const [channelId] of ptyChannels) {
        cleanupPtyChannel(channelId);
      }

      logInfo(`[tunnel] Disconnected. Reconnecting in ${reconnectMs}ms...`);
      setTimeout(connect, reconnectMs);
      reconnectMs = Math.min(reconnectMs * 2, MAX_RECONNECT_MS);
    });

    ws.addEventListener('error', (err) => {
      logError('[tunnel] WebSocket error:', err);
    });
  }

  connect();
}

// ── Request handler (exec, fs, health) ────────────────────────────

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
      return { id: req.id, status: 200, body: { ok: true } };
    }

    return { id: req.id, status: 404, error: `Unknown path: ${path}` };
  } catch (err: any) {
    return { id: req.id, status: 500, error: err.message };
  }
}

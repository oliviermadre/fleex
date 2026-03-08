// ── Tunnel PTY Handler (Gateway-Side) ──
//
// Manages multiplexed PTY sessions over the tunnel.
// Each PTY gets a unique channelId assigned by the server.

import { execFileSync } from 'node:child_process';
import { logInfo, logError } from './logger';
import type { TunnelPtyOpenPayload } from '@fleex/shared';

import {
  TunnelMsgType,
} from '../../shared/src/types/gateway-tunnel';

import {
  encodeTunnelJson,
  encodeTunnelRaw,
} from '../../shared/src/tunnel-codec';

function resolveTmuxPath(): string {
  try {
    return execFileSync('which', ['tmux'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'tmux';
  }
}

const TMUX_PATH = resolveTmuxPath();

interface PtySession {
  channelId: number;
  proc: ReturnType<typeof Bun.spawn>;
  terminal: any;
}

export interface TunnelPtyHandler {
  open(channelId: number, payload: TunnelPtyOpenPayload): void;
  write(channelId: number, data: Uint8Array): void;
  resize(channelId: number, cols: number, rows: number): void;
  close(channelId: number): void;
  closeAll(): void;
}

export function createTunnelPtyHandler(
  sendFrame: (data: Uint8Array) => void,
): TunnelPtyHandler {
  const sessions = new Map<number, PtySession>();

  return {
    open(channelId: number, payload: TunnelPtyOpenPayload): void {
      const { tmuxSessionName, cols, rows } = payload;

      try {
        // Strip TMUX/TMUX_PANE so tmux attach works inside tmux
        const { TMUX, TMUX_PANE, ...cleanEnv } = process.env;

        const proc = Bun.spawn([TMUX_PATH, 'attach', '-t', tmuxSessionName], {
          cwd: process.cwd(),
          env: cleanEnv as Record<string, string>,
          terminal: {
            cols,
            rows,
            name: 'xterm-256color',
            data(_terminal: any, data: Buffer) {
              // Send PTY output back through tunnel
              sendFrame(encodeTunnelRaw(channelId, TunnelMsgType.PTY_DATA, new Uint8Array(data)));
            },
            exit(_terminal: any) {
              logInfo(`[tunnel-pty] terminal exited for channel ${channelId}`);
            },
          },
        });

        const session: PtySession = { channelId, proc, terminal: proc.terminal };
        sessions.set(channelId, session);
        logInfo(`[tunnel-pty] opened channel=${channelId} pid=${proc.pid} tmux="${tmuxSessionName}"`);

        // Notify server that PTY is ready
        sendFrame(encodeTunnelJson(channelId, TunnelMsgType.PTY_OPENED, { ok: true }));

        // Handle exit
        proc.exited.then((exitCode) => {
          logInfo(`[tunnel-pty] exited channel=${channelId} exitCode=${exitCode}`);
          sendFrame(encodeTunnelJson(channelId, TunnelMsgType.PTY_EXIT, {
            exitCode: exitCode ?? 0,
          }));
          sessions.delete(channelId);
        });

      } catch (err: any) {
        logError(`[tunnel-pty] spawn failed for channel ${channelId}:`, err);
        sendFrame(encodeTunnelJson(channelId, TunnelMsgType.PTY_ERROR, {
          message: String(err),
        }));
      }
    },

    write(channelId: number, data: Uint8Array): void {
      const session = sessions.get(channelId);
      if (session?.terminal) {
        session.terminal.write(data);
      }
    },

    resize(channelId: number, cols: number, rows: number): void {
      const session = sessions.get(channelId);
      if (session?.terminal) {
        session.terminal.resize(cols, rows);
      }
    },

    close(channelId: number): void {
      const session = sessions.get(channelId);
      if (session) {
        try {
          if (session.terminal) session.terminal.close();
        } catch { /* Already closed */ }
        try {
          session.proc.kill();
        } catch { /* Already dead */ }
        sessions.delete(channelId);
      }
    },

    closeAll(): void {
      for (const [, session] of sessions) {
        try {
          if (session.terminal) session.terminal.close();
        } catch { /* */ }
        try {
          session.proc.kill();
        } catch { /* */ }
      }
      sessions.clear();
    },
  };
}

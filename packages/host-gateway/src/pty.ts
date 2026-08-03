import { execFileSync } from 'node:child_process';

import { logInfo, logError } from './logger';

import type { ServerWebSocket } from 'bun';

interface PtyInitMessage {
  tmuxSessionName: string;
  cols: number;
  rows: number;
}

interface PtyResizeMessage {
  type: 'resize';
  cols: number;
  rows: number;
}

interface PtyWsData {
  initialized: boolean;
  proc: ReturnType<typeof Bun.spawn> | null;
  terminal: any;
}

function resolveTmuxPath(): string {
  try {
    return execFileSync('which', ['tmux'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'tmux';
  }
}

const TMUX_PATH = resolveTmuxPath();

export function handlePtyOpen(ws: ServerWebSocket<PtyWsData>) {
  logInfo('[pty] WebSocket connected, waiting for init message');
}

export function handlePtyMessage(ws: ServerWebSocket<PtyWsData>, message: string | Buffer) {
  // If not initialized yet, expect a JSON init message
  if (!ws.data.initialized) {
    try {
      const init = JSON.parse(String(message)) as PtyInitMessage;
      const { tmuxSessionName, cols, rows } = init;

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
          data(_terminal, data) {
            try {
              ws.sendBinary(data);
            } catch (err) {
              logError('[pty] send failed:', err);
            }
          },
          exit(_terminal) {
            logInfo(`[pty] terminal exited for tmux session "${tmuxSessionName}"`);
          },
        },
      });

      ws.data.proc = proc;
      ws.data.terminal = proc.terminal;
      ws.data.initialized = true;
      logInfo(`[pty] spawned pid=${proc.pid} for tmux session "${tmuxSessionName}"`);

      // Handle process exit
      proc.exited.then((exitCode) => {
        logInfo(`[pty] exited pid=${proc.pid} exitCode=${exitCode}`);
        try {
          ws.send(JSON.stringify({ type: 'exit', exitCode: exitCode ?? 0 }));
          ws.close();
        } catch {
          // WebSocket may have closed
        }
      });
    } catch (err) {
      logError('[pty] spawn failed:', err);
      ws.send(JSON.stringify({ type: 'error', message: String(err) }));
      ws.close();
    }
    return;
  }

  // Once initialized, handle binary I/O and JSON control messages
  if (typeof message === 'string') {
    try {
      const ctrl = JSON.parse(message) as PtyResizeMessage;
      if (ctrl.type === 'resize' && ws.data.terminal) {
        ws.data.terminal.resize(ctrl.cols, ctrl.rows);
      }
    } catch {
      // Ignore unparseable strings
    }
    return;
  }

  // Binary frame: write to PTY
  if (ws.data.terminal) {
    ws.data.terminal.write(message);
  }
}

export function handlePtyClose(ws: ServerWebSocket<PtyWsData>) {
  if (ws.data.terminal) {
    try {
      ws.data.terminal.close();
    } catch {
      // Already closed
    }
    ws.data.terminal = null;
  }
  if (ws.data.proc) {
    try {
      ws.data.proc.kill();
    } catch {
      // Already dead
    }
    ws.data.proc = null;
  }
}

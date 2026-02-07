import { execFileSync } from 'node:child_process';
import pty from 'node-pty';
import type { PtyHandle, TerminalDimensions } from '@asm/shared';
import type { PtyPort } from '../../application/ports/pty.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

function resolveTmuxPath(): string {
  try {
    return execFileSync('which', ['tmux'], { encoding: 'utf-8' }).trim();
  } catch {
    return 'tmux'; // fallback to PATH lookup
  }
}

const TMUX_PATH = resolveTmuxPath();

export class NodePtyAdapter implements PtyPort {
  constructor(private readonly logger: LoggerPort) {}

  spawnAttach(tmuxSessionName: string, dims: TerminalDimensions): PtyHandle {
    this.logger.debug('Using tmux at', { path: TMUX_PATH });
    const proc = pty.spawn(TMUX_PATH, ['attach', '-t', tmuxSessionName], {
      name: 'xterm-256color',
      cols: dims.cols,
      rows: dims.rows,
      cwd: process.cwd(),
      env: process.env as Record<string, string>,
    });

    this.logger.debug('PTY spawned for tmux attach', { tmuxSessionName, pid: proc.pid });

    let alive = true;
    const exitCallbacks: Array<(exitCode: number, signal: number) => void> = [];

    proc.onExit(({ exitCode, signal }) => {
      alive = false;
      for (const cb of exitCallbacks) {
        cb(exitCode ?? 0, signal ?? 0);
      }
    });

    return {
      write(data: string) {
        proc.write(data);
      },
      resize(d: TerminalDimensions) {
        proc.resize(d.cols, d.rows);
      },
      onData(cb: (data: Buffer) => void) {
        proc.onData((data) => {
          cb(Buffer.from(data));
        });
      },
      onExit(cb: (exitCode: number, signal: number) => void) {
        exitCallbacks.push(cb);
      },
      kill() {
        if (alive) {
          proc.kill();
          alive = false;
        }
      },
      get isAlive() {
        return alive;
      },
    };
  }
}

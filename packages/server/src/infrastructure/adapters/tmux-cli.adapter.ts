import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ASM_PREFIX, DEFAULT_COLS, DEFAULT_ROWS } from '@asm/shared';
import type { TmuxPort, TmuxSessionInfo } from '../../application/ports/tmux.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

const execFileAsync = promisify(execFile);

export class TmuxCliAdapter implements TmuxPort {
  constructor(private readonly logger: LoggerPort) {}

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('tmux', ['-V']);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(opts: {
    name: string;
    cwd: string;
    command?: string;
  }): Promise<void> {
    const args = [
      'new-session',
      '-d',
      '-s', opts.name,
      '-c', opts.cwd,
      '-x', String(DEFAULT_COLS),
      '-y', String(DEFAULT_ROWS),
    ];

    if (opts.command) {
      args.push(opts.command);
    }

    await execFileAsync('tmux', args);
    await execFileAsync('tmux', ['set-option', '-t', opts.name, 'mouse', 'on']);
    // Override WheelUpPane to always enter copy-mode on scroll
    // (bypasses shell mouse tracking that would otherwise cycle command history)
    await execFileAsync('tmux', [
      'bind-key', '-T', 'root', 'WheelUpPane',
      'if-shell', '-F', '#{pane_in_mode}', 'send-keys -M', 'copy-mode -e',
    ]);
    this.logger.debug('tmux session created', { name: opts.name });
  }

  async killSession(name: string): Promise<void> {
    await execFileAsync('tmux', ['kill-session', '-t', name]);
    this.logger.debug('tmux session killed', { name });
  }

  async hasSession(name: string): Promise<boolean> {
    try {
      await execFileAsync('tmux', ['has-session', '-t', name]);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    try {
      const { stdout } = await execFileAsync('tmux', [
        'list-sessions',
        '-F',
        '#{session_name},#{session_created},#{session_attached},#{session_width},#{session_height}',
      ]);

      return stdout
        .trim()
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => {
          const parts = line.split(',');
          return {
            name: parts[0] ?? '',
            created: parts[1] ?? '',
            attached: parts[2] === '1',
            width: parseInt(parts[3] ?? '0', 10),
            height: parseInt(parts[4] ?? '0', 10),
          };
        });
    } catch {
      // No tmux server running
      return [];
    }
  }

  async listManagedSessions(): Promise<TmuxSessionInfo[]> {
    const all = await this.listSessions();
    return all.filter((s) => s.name.startsWith(ASM_PREFIX));
  }

  async sendKeys(name: string, keys: string): Promise<void> {
    await execFileAsync('tmux', ['send-keys', '-t', name, keys, 'Enter']);
    this.logger.debug('tmux send-keys', { name });
  }
}

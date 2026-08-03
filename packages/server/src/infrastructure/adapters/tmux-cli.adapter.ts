import { FLEEX_PREFIX, DEFAULT_COLS, DEFAULT_ROWS } from '@fleex/shared';

import type { LoggerPort } from '../../application/ports/logger.port.js';
import type {
  TmuxPort,
  TmuxSessionInfo,
  ManagedSessionsWithPanes,
} from '../../application/ports/tmux.port.js';
import type { ExecFn } from '../host/types.js';

/** Cache resolved binary names for version-titled pane processes (e.g. claude CLI) */
const resolvedBinaryCache = new Map<string, string>();

export class TmuxCliAdapter implements TmuxPort {
  constructor(
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
  ) {}

  async isAvailable(): Promise<boolean> {
    try {
      await this.execFn('tmux', ['-V']);
      return true;
    } catch {
      return false;
    }
  }

  async createSession(opts: { name: string; cwd: string; command?: string }): Promise<void> {
    const args = [
      'new-session',
      '-d',
      '-s',
      opts.name,
      '-c',
      opts.cwd,
      '-x',
      String(DEFAULT_COLS),
      '-y',
      String(DEFAULT_ROWS),
    ];

    if (opts.command) {
      args.push(opts.command);
    }

    await this.execFn('tmux', args);
    await this.execFn('tmux', ['set-option', '-t', opts.name, 'mouse', 'on']);
    await this.execFn('tmux', ['set-option', '-t', opts.name, 'set-clipboard', 'on']);
    // Override WheelUpPane to always enter copy-mode on scroll
    // (bypasses shell mouse tracking that would otherwise cycle command history)
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'root',
      'WheelUpPane',
      'if-shell',
      '-F',
      '#{pane_in_mode}',
      'send-keys -M',
      'copy-mode -e',
    ]);
    // Scroll 1 line at a time in copy-mode (default is 5, too aggressive for trackpads)
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode',
      'WheelUpPane',
      'send-keys',
      '-X',
      'scroll-up',
    ]);
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode',
      'WheelDownPane',
      'send-keys',
      '-X',
      'scroll-down',
    ]);
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode-vi',
      'WheelUpPane',
      'send-keys',
      '-X',
      'scroll-up',
    ]);
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode-vi',
      'WheelDownPane',
      'send-keys',
      '-X',
      'scroll-down',
    ]);
    // Keep selection visible after mouse drag without copying to clipboard
    // (user explicitly copies with Cmd+C / Ctrl+Shift+C)
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode',
      'MouseDragEnd1Pane',
      'send-keys',
      '-X',
      'stop-selection',
    ]);
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode-vi',
      'MouseDragEnd1Pane',
      'send-keys',
      '-X',
      'stop-selection',
    ]);
    // Ctrl+C: copy selection in copy-mode, SIGINT outside (natural behavior)
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode',
      'C-c',
      'send-keys',
      '-X',
      'copy-selection-no-clear',
    ]);
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode-vi',
      'C-c',
      'send-keys',
      '-X',
      'copy-selection-no-clear',
    ]);
    // Virtual key (User0) for Cmd+C on macOS (doesn't generate \x03).
    // Only bound in copy-mode — no-op outside.
    await this.execFn('tmux', ['set', '-s', 'user-keys[0]', '\x1b[99~']);
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode',
      'User0',
      'send-keys',
      '-X',
      'copy-selection-no-clear',
    ]);
    await this.execFn('tmux', [
      'bind-key',
      '-T',
      'copy-mode-vi',
      'User0',
      'send-keys',
      '-X',
      'copy-selection-no-clear',
    ]);
    this.logger.debug('tmux session created', { name: opts.name });
  }

  async killSession(name: string): Promise<void> {
    await this.execFn('tmux', ['kill-session', '-t', name]);
    this.logger.debug('tmux session killed', { name });
  }

  async hasSession(name: string): Promise<boolean> {
    try {
      await this.execFn('tmux', ['has-session', '-t', name]);
      return true;
    } catch {
      return false;
    }
  }

  async listSessions(): Promise<TmuxSessionInfo[]> {
    try {
      const { stdout } = await this.execFn('tmux', [
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
    } catch (err: any) {
      // tmux exits with code 1 and "no server running" when there are genuinely no sessions
      if (err.code === 1 || (err.message && err.message.includes('no server running'))) {
        return [];
      }
      throw err;
    }
  }

  async listManagedSessions(): Promise<TmuxSessionInfo[]> {
    const all = await this.listSessions();
    return all.filter((s) => s.name.startsWith(FLEEX_PREFIX));
  }

  async listManagedSessionsWithPaneCommands(): Promise<ManagedSessionsWithPanes> {
    try {
      const { stdout } = await this.execFn('tmux', [
        'list-panes',
        '-a',
        '-F',
        '#{session_name},#{session_created},#{session_attached},#{window_width},#{window_height},#{pane_pid},#{pane_current_command},#{pane_current_path}',
      ]);

      const sessionMap = new Map<string, TmuxSessionInfo>();
      const paneCommands = new Map<string, string>();
      const paneCwds = new Map<string, string>();
      const pidsToResolve: { sessionName: string; pid: string }[] = [];
      const activePids = new Set<string>();

      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length < 8) continue;

        const sessionName = parts[0] ?? '';
        if (!sessionName.startsWith(FLEEX_PREFIX)) continue;

        // Build session info (deduplicated by name)
        if (!sessionMap.has(sessionName)) {
          sessionMap.set(sessionName, {
            name: sessionName,
            created: parts[1] ?? '',
            attached: parts[2] === '1',
            width: parseInt(parts[3] ?? '0', 10),
            height: parseInt(parts[4] ?? '0', 10),
          });
        }

        const pid = parts[5] ?? '';
        const command = parts[6] ?? '';
        const paneCwd = parts[7] ?? '';
        if (paneCwd) paneCwds.set(sessionName, paneCwd);
        activePids.add(pid);

        // Claude CLI sets its process title to its version number (e.g. "2.1.49")
        if (/^\d+\.\d+/.test(command)) {
          // Check cache first
          const cached = resolvedBinaryCache.get(pid);
          if (cached) {
            paneCommands.set(sessionName, cached);
          } else {
            pidsToResolve.push({ sessionName, pid });
          }
        } else {
          paneCommands.set(sessionName, command);
        }
      }

      // Resolve uncached version-titled processes
      for (const { sessionName, pid } of pidsToResolve) {
        try {
          const { stdout: pgrepOut } = await this.execFn('pgrep', ['-P', pid]);
          const childPid = pgrepOut.trim().split('\n')[0];
          if (childPid) {
            const { stdout: psOut } = await this.execFn('ps', ['-p', childPid, '-o', 'comm=']);
            const binary = psOut.trim().split('/').pop() ?? '';
            const resolved = binary || 'unknown';
            resolvedBinaryCache.set(pid, resolved);
            paneCommands.set(sessionName, resolved);
          }
        } catch {
          paneCommands.set(sessionName, 'unknown');
        }
      }

      // Evict stale cache entries for PIDs no longer in any pane
      for (const cachedPid of resolvedBinaryCache.keys()) {
        if (!activePids.has(cachedPid)) {
          resolvedBinaryCache.delete(cachedPid);
        }
      }

      return {
        sessions: Array.from(sessionMap.values()),
        paneCommands,
        paneCwds,
      };
    } catch (err: any) {
      if (err.code === 1 || (err.message && err.message.includes('no server running'))) {
        return { sessions: [], paneCommands: new Map(), paneCwds: new Map() };
      }
      throw err;
    }
  }

  async renameSession(oldName: string, newName: string): Promise<void> {
    await this.execFn('tmux', ['rename-session', '-t', oldName, newName]);
    this.logger.debug('tmux session renamed', { oldName, newName });
  }

  async sendKeys(name: string, keys: string): Promise<void> {
    await this.execFn('tmux', ['send-keys', '-t', name, keys, 'Enter']);
    this.logger.debug('tmux send-keys', { name });
  }

  async getPaneCommands(): Promise<Map<string, string>> {
    try {
      const { stdout } = await this.execFn('tmux', [
        'list-panes',
        '-a',
        '-F',
        '#{session_name} #{pane_pid} #{pane_current_command}',
      ]);

      const result = new Map<string, string>();
      const pidsToResolve: { sessionName: string; pid: string }[] = [];

      for (const line of stdout.trim().split('\n')) {
        if (!line) continue;
        const firstSpace = line.indexOf(' ');
        if (firstSpace === -1) continue;
        const sessionName = line.slice(0, firstSpace);
        if (!sessionName.startsWith(FLEEX_PREFIX)) continue;
        const rest = line.slice(firstSpace + 1);
        const secondSpace = rest.indexOf(' ');
        if (secondSpace === -1) continue;
        const pid = rest.slice(0, secondSpace);
        const command = rest.slice(secondSpace + 1);

        // Claude CLI sets its process title to its version number (e.g. "2.1.49")
        if (/^\d+\.\d+/.test(command)) {
          pidsToResolve.push({ sessionName, pid });
        } else {
          result.set(sessionName, command);
        }
      }

      // Resolve actual binary name for version-like process titles (e.g. claude CLI)
      // pane_pid is the shell — find its child process and check the real binary
      for (const { sessionName, pid } of pidsToResolve) {
        try {
          const { stdout: pgrepOut } = await this.execFn('pgrep', ['-P', pid]);
          const childPid = pgrepOut.trim().split('\n')[0];
          if (childPid) {
            const { stdout: psOut } = await this.execFn('ps', ['-p', childPid, '-o', 'comm=']);
            const binary = psOut.trim().split('/').pop() ?? '';
            result.set(sessionName, binary || 'unknown');
          }
        } catch {
          result.set(sessionName, 'unknown');
        }
      }

      return result;
    } catch (err: any) {
      if (err.code === 1 || (err.message && err.message.includes('no server running'))) {
        return new Map();
      }
      throw err;
    }
  }

  async getSessionCwd(name: string): Promise<string | null> {
    try {
      const { stdout } = await this.execFn('tmux', [
        'display-message',
        '-p',
        '-t',
        name,
        '#{pane_current_path}',
      ]);
      const cwd = stdout.trim();
      return cwd || null;
    } catch {
      return null;
    }
  }
}

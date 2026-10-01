import type { TerminalRunHandle, TerminalRunPort } from '../../domain/services/action-run.service.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn, HostFs } from '../host/types.js';

/**
 * Prefix of the tmux sessions that run terminal-mode actions. Deliberately NOT
 * `fleex_` (FLEEX_PREFIX): those are adopted as user sessions by discovery and
 * listed everywhere; action terminals must stay invisible outside their panel.
 */
export const ACTION_TMUX_PREFIX = 'fxact_';

/** Safety net only — an interactive login may legitimately wait on the user. */
export const TERMINAL_MAX_MS = 4 * 60 * 60 * 1000;
const POLL_MS = 1000;
const LOG_TAIL_BYTES = 128 * 1024;

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// CSI / OSC / two-char escapes, then carriage returns from the TTY.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export function stripTerminalOutput(raw: string): string {
  return raw.replace(ANSI, '').replace(/\r+\n/g, '\n').replace(/\r/g, '');
}

export interface TmuxTerminalRunnerOptions {
  /**
   * Distinguishes this server instance (its port): several Fleex instances may
   * share the machine's tmux server, and each must only ever clean up its own
   * action terminals.
   */
  instanceTag?: string;
  pollMs?: number;
  maxMs?: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

/**
 * Terminal-mode actions: the command runs in its own tmux session, in an
 * interactive login zsh (`-l -i`: .zshrc loaded, aliases and functions work, a
 * real TTY). The floating panel attaches to it like any terminal. The pane
 * stays readable after the command ends (`remain-on-exit`), which is also how
 * its real exit code is read (`#{pane_dead_status}`); the output is captured
 * with `pipe-pane` so the logs show it like any other run.
 */
export class TmuxTerminalRunner implements TerminalRunPort {
  constructor(
    private readonly execFn: ExecFn,
    private readonly hostFs: HostFs,
    private readonly tmpDir: string,
    private readonly logger: LoggerPort,
    private readonly options: TmuxTerminalRunnerOptions = {},
  ) {}

  sessionNameFor(sourceId: string): string {
    const slug = sourceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 48) || 'action';
    return `${this.ownPrefix()}${slug}`;
  }

  async start(request: { runId: string; command: string; cwd: string; sessionName: string }): Promise<TerminalRunHandle> {
    const { runId, command, cwd, sessionName: name } = request;
    const logFile = `${this.tmpDir.replace(/\/$/, '')}/fleex-action-${runId}.log`;
    const gate = `fxgo_${runId}`;

    // One terminal per source: a new run replaces the previous one.
    await this.kill(name);
    // The command waits on a tmux channel until output capture and
    // remain-on-exit are in place — an instant exit would otherwise be lost.
    const inner = `tmux wait-for ${shellQuote(gate)}; exec /bin/zsh -l -i -c ${shellQuote(command)}`;
    await this.execFn('tmux', ['new-session', '-d', '-s', name, '-c', cwd, '-x', '120', '-y', '32', inner]);
    await this.execFn('tmux', ['set-window-option', '-t', name, 'remain-on-exit', 'on']);
    await this.execFn('tmux', ['set-option', '-t', name, 'mouse', 'on']);
    await this.execFn('tmux', ['pipe-pane', '-o', '-t', name, `cat >> ${shellQuote(logFile)}`]);
    await this.execFn('tmux', ['wait-for', '-S', gate]);

    let cancelled = false;
    let timedOut = false;
    const setTimer = this.options.setTimer ?? setTimeout;
    const clearTimer = this.options.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>));

    const done = new Promise<{ exitCode: number; output: string; cancelled: boolean; timedOut: boolean }>((resolve) => {
      let finished = false;
      const guard = setTimer(() => {
        timedOut = true;
        void this.kill(name);
      }, this.options.maxMs ?? TERMINAL_MAX_MS);

      const finish = async (exitCode: number) => {
        if (finished) return;
        finished = true;
        clearTimer(guard);
        const output = await this.readOutput(logFile);
        resolve({ exitCode, output, cancelled, timedOut });
      };

      const poll = async () => {
        if (finished) return;
        const state = await this.paneState(name);
        if (state === 'gone') {
          // Killed (Stop, panel closed, timeout guard) before the command ended.
          if (!timedOut) cancelled = true;
          await finish(130);
          return;
        }
        if (state.dead) {
          await finish(state.status);
          return;
        }
        setTimer(() => void poll(), this.options.pollMs ?? POLL_MS);
      };
      setTimer(() => void poll(), this.options.pollMs ?? POLL_MS);
    });

    return {
      done,
      cancel: async () => {
        cancelled = true;
        await this.kill(name);
      },
    };
  }

  /** Close a finished run's terminal (its pane was kept readable until now). */
  async close(sessionName: string): Promise<void> {
    if (!sessionName.startsWith(this.ownPrefix())) return;
    await this.kill(sessionName);
  }

  /** At server start: no action terminal survives a restart (nothing tracks it any more). */
  async killOrphans(): Promise<number> {
    let names: string[] = [];
    try {
      const { stdout } = await this.execFn('tmux', ['list-sessions', '-F', '#{session_name}']);
      names = stdout.split('\n').map((s) => s.trim()).filter((s) => s.startsWith(this.ownPrefix()));
    } catch {
      return 0; // no tmux server running
    }
    for (const name of names) await this.kill(name);
    if (names.length) this.logger.info('Killed orphan action terminals', { count: names.length });
    return names.length;
  }

  private ownPrefix(): string {
    const tag = (this.options.instanceTag ?? '').replace(/[^A-Za-z0-9]/g, '');
    return tag ? `${ACTION_TMUX_PREFIX}${tag}_` : ACTION_TMUX_PREFIX;
  }

  private async paneState(name: string): Promise<'gone' | { dead: boolean; status: number }> {
    try {
      const { stdout } = await this.execFn('tmux', ['list-panes', '-t', name, '-F', '#{pane_dead} #{pane_dead_status}']);
      const [dead, status] = stdout.trim().split('\n')[0]!.split(' ');
      return { dead: dead === '1', status: Number.parseInt(status ?? '', 10) || 0 };
    } catch {
      return 'gone';
    }
  }

  private async kill(name: string): Promise<void> {
    try {
      await this.execFn('tmux', ['kill-session', '-t', name]);
    } catch { /* already gone */ }
  }

  private async readOutput(logFile: string): Promise<string> {
    try {
      const raw = await this.hostFs.readTail(logFile, LOG_TAIL_BYTES);
      await this.hostFs.rm(logFile).catch(() => {});
      return stripTerminalOutput(raw);
    } catch {
      return '';
    }
  }
}

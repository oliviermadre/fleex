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

/**
 * A worktree's dev server (`wt:<hash>::start` → `…_wt_<hash>__start`): long
 * lived on purpose, so it survives a Fleex restart and is adopted back.
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export function isWorktreeServerSession(name: string): boolean {
  return /_wt_[a-z0-9]+__start_[0-9a-f]{8}$/.test(name);
}

/** What `inspect` sees of a session: its pane, and the TCP ports its process tree listens on. */
export interface SessionInspection {
  alive: boolean;
  /** The command ended (pane kept by remain-on-exit). */
  dead: boolean;
  exitStatus?: number;
  ports: number[];
}

/** `lsof -F n` lines (`n*:5173`, `n127.0.0.1:3000`, `n[::1]:8080`) → sorted unique ports. */
export function parseLsofPorts(output: string): number[] {
  const ports = new Set<number>();
  for (const line of output.split('\n')) {
    const m = /^n.*:(\d+)$/.exec(line.trim());
    if (m) ports.add(Number(m[1]));
  }
  return [...ports].filter((p) => p > 0 && p < 65536).sort((a, b) => a - b);
}

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

  /**
   * A readable session name per key. When the key does not survive as is (a
   * character tmux rejects, or longer than 48), a hash of the full key is
   * appended: `build.prod` and `build_prod`, or two long ids sharing a prefix,
   * must not share a session — starting one kills the session of that name.
   */
  sessionNameFor(sourceId: string): string {
    const safe = sourceId.replace(/[^A-Za-z0-9_-]/g, '_');
    if (safe && safe === sourceId && safe.length <= 48) return `${this.ownPrefix()}${safe}`;
    return `${this.ownPrefix()}${safe.slice(0, 39) || 'action'}_${fnv1a(sourceId)}`;
  }

  async start(request: { runId: string; command: string; cwd: string; sessionName: string; maxMs?: number }): Promise<TerminalRunHandle> {
    const { runId, command, cwd, sessionName: name } = request;
    // 0 = no safety net (a worktree's dev server runs until stopped).
    const maxMs = request.maxMs ?? this.options.maxMs ?? TERMINAL_MAX_MS;
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
      const guard = maxMs > 0
        ? setTimer(() => {
            timedOut = true;
            void this.kill(name);
          }, maxMs)
        : null;

      const finish = async (exitCode: number) => {
        if (finished) return;
        finished = true;
        if (guard !== null) clearTimer(guard);
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

  /**
   * At server start: no action terminal survives a restart (nothing tracks it
   * any more) — except those `keep` spares (worktree dev servers, adopted back).
   */
  async killOrphans(keep: (name: string) => boolean = () => false): Promise<number> {
    let names: string[] = [];
    try {
      const { stdout } = await this.execFn('tmux', ['list-sessions', '-F', '#{session_name}']);
      names = stdout.split('\n').map((s) => s.trim()).filter((s) => s.startsWith(this.ownPrefix()) && !keep(s));
    } catch {
      return 0; // no tmux server running
    }
    for (const name of names) await this.kill(name);
    if (names.length) this.logger.info('Killed orphan action terminals', { count: names.length });
    return names.length;
  }

  /**
   * Is the session there, has its command ended, and which TCP ports does its
   * process tree listen on (pane pid and all descendants, through lsof).
   */
  async inspect(sessionName: string): Promise<SessionInspection> {
    const state = await this.paneState(sessionName);
    if (state === 'gone') return { alive: false, dead: false, ports: [] };
    if (state.dead) return { alive: true, dead: true, exitStatus: state.status, ports: [] };
    const script = [
      ...processTreeScript(sessionName),
      'lsof -nP -a -iTCP -sTCP:LISTEN -p "$(echo $all | tr " " ",")" -Fn 2>/dev/null || true',
    ].join('\n');
    try {
      const { stdout } = await this.execFn('sh', ['-c', script]);
      return { alive: true, dead: false, ports: parseLsofPorts(stdout) };
    } catch {
      return { alive: true, dead: false, ports: [] };
    }
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

  /**
   * Ends a session for good. Closing the pane only sends SIGHUP to its
   * foreground job: `npm run dev` → vite, concurrently, `docker compose up`…
   * may leave children behind, holding the port for the next worktree. So the
   * whole process tree gets SIGTERM, a grace period, then SIGKILL — and only
   * then is the session closed.
   */
  private async kill(name: string): Promise<void> {
    try {
      await this.execFn('sh', ['-c', [
        ...processTreeScript(name),
        'kill -TERM $all 2>/dev/null',
        `i=0; while [ $i -lt ${KILL_GRACE_TICKS} ]; do alive=""; for p in $all; do kill -0 "$p" 2>/dev/null && alive="$alive $p"; done; [ -z "$alive" ] && exit 0; sleep 0.1; i=$((i+1)); done`,
        'kill -KILL $alive 2>/dev/null; exit 0',
      ].join('\n')]);
    } catch { /* nothing to signal */ }
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

/** Grace period between SIGTERM and SIGKILL, in 0.1 s ticks (5 s). */
const KILL_GRACE_TICKS = 50;

/** Sets `$all` to the pane's pid and all its descendants (empty session → exit 0). */
function processTreeScript(sessionName: string): string[] {
  return [
    `pid=$(tmux list-panes -t ${shellQuote(sessionName)} -F '#{pane_pid}' 2>/dev/null | head -1)`,
    '[ -z "$pid" ] && exit 0',
    'all=$pid; frontier=$pid',
    'while [ -n "$frontier" ]; do next=""; for p in $frontier; do next="$next $(pgrep -P "$p" 2>/dev/null)"; done; frontier=$(echo $next); all="$all $frontier"; done',
  ];
}

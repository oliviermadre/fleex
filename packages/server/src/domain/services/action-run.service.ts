import { randomUUID } from 'node:crypto';
import { ACTION_DEFAULT_TIMEOUT_SEC, ACTION_MAX_TIMEOUT_SEC, isSlotOf, runSlotKey } from '@fleex/shared';
import type { ActionRun, ActionRunOutputChunk, ActionRunRequest } from '@fleex/shared';

export const RUNS_PER_SOURCE = 20;
export const RUNS_TOTAL = 200;
export const RUN_OUTPUT_MAX_BYTES = 64 * 1024;
/** Live output is batched: one message per stream at most this often… */
export const OUTPUT_FLUSH_MS = 250;
/** …and at most this big. Beyond, the message says how much was skipped (the final log has it). */
export const OUTPUT_CHUNK_MAX_BYTES = 16 * 1024;

export type RunExecFn = (
  command: string,
  options: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;

export interface StreamExecHandle {
  done: Promise<{ exitCode: number; timedOut: boolean; cancelled: boolean }>;
  cancel(): Promise<void>;
}

/** Streaming exec; resolves to null when the gateway does not stream (not restarted yet). */
export type RunStreamExecFn = (
  command: string,
  options: { cwd: string; timeoutMs: number; onOutput: (stream: 'stdout' | 'stderr', chunk: string) => void },
) => Promise<StreamExecHandle | null>;

export interface TerminalRunHandle {
  done: Promise<{ exitCode: number; output: string; cancelled: boolean; timedOut: boolean }>;
  cancel(): Promise<void>;
}

/** Runs a command in a visible, interactive terminal (tmux). */
export interface TerminalRunPort {
  /** The tmux session a source's terminal run uses — known before it exists. */
  sessionNameFor(sourceId: string): string;
  start(request: { runId: string; sourceId: string; command: string; cwd: string; sessionName: string }): Promise<TerminalRunHandle>;
  /** Kill a finished run's terminal (kept readable until the user closes it). */
  close(sessionName: string): Promise<void>;
}

export type ActionRunBroadcastType = 'action-run:started' | 'action-run:finished' | 'action-run:output';

export interface ActionRunDeps {
  exec: RunExecFn;
  streamExec?: RunStreamExecFn;
  terminal?: TerminalRunPort;
  /** Default cwd (the gateway user's home) when the request names none. */
  defaultCwd: string;
  broadcast: (type: ActionRunBroadcastType, data: ActionRun | ActionRunOutputChunk) => void;
  /** Called once a run ends — used to re-probe the icon it belongs to. */
  onFinished?: (run: ActionRun) => void;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export type StartRunResult = { ok: true; run: ActionRun } | { ok: false; runningRunId: string };

export function clampActionTimeout(sec: number | undefined): number {
  if (!Number.isFinite(sec) || !sec || sec <= 0) return ACTION_DEFAULT_TIMEOUT_SEC;
  // At least 1 s: a 0 would reach execFile as "no timeout" and lock the source forever.
  return Math.min(ACTION_MAX_TIMEOUT_SEC, Math.max(1, Math.round(sec)));
}

const TRUNCATED_MARK = '…(truncated)\n';

export function truncateOutput(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= RUN_OUTPUT_MAX_BYTES) return text;
  // Keep the tail: an error is usually at the end of the output.
  const buf = Buffer.from(text, 'utf8');
  return `${TRUNCATED_MARK}${buf.subarray(buf.length - RUN_OUTPUT_MAX_BYTES).toString('utf8')}`;
}

/** Last `max` bytes of a string, plus how many bytes were cut. */
function tail(text: string, max: number): { text: string; cut: number } {
  const size = Buffer.byteLength(text, 'utf8');
  if (size <= max) return { text, cut: 0 };
  const buf = Buffer.from(text, 'utf8');
  return { text: buf.subarray(size - max).toString('utf8'), cut: size - max };
}

/** Accumulates a stream's output without ever holding more than ~2× the kept tail. */
class OutputTail {
  private text = '';
  private cut = false;

  append(chunk: string): void {
    this.text += chunk;
    if (this.text.length > RUN_OUTPUT_MAX_BYTES * 2) {
      this.text = tail(this.text, RUN_OUTPUT_MAX_BYTES).text;
      this.cut = true;
    }
  }

  value(): string {
    const kept = truncateOutput(this.text);
    return this.cut && !kept.startsWith(TRUNCATED_MARK) ? `${TRUNCATED_MARK}${kept}` : kept;
  }
}

interface LiveRun {
  run: ActionRun;
  stdout: OutputTail;
  stderr: OutputTail;
  pending: { stdout: string; stderr: string };
  /** Bytes cut from `pending` before a flush — reported as `dropped`. */
  carried: { stdout: number; stderr: number };
  seq: number;
  timer: unknown;
  cancel?: () => Promise<void>;
  cancelRequested: boolean;
  /** Settles once a terminal run's tmux session exists (attach waits on it). */
  terminalReady?: Promise<void>;
}

/**
 * Runs pinned / workspace shell actions asynchronously and keeps their outcome.
 *
 * A run is answered at once with an id, executes in the background with a real
 * timeout, streams its output live (batched every 250 ms, ≤ 16 KB a message)
 * and can be stopped. In terminal mode it runs in a visible tmux session the
 * user types into instead — interactive zsh, .zshrc loaded, a real TTY.
 *
 * History is in memory only (20 per source, 200 overall): it is for "what did
 * that click just do", not an audit log, and losing it on restart is fine.
 */
export class ActionRunService {
  private readonly runs: ActionRun[] = [];
  private readonly running = new Map<string, string>();
  private readonly live = new Map<string, LiveRun>();

  constructor(private readonly deps: ActionRunDeps) {}

  start(request: ActionRunRequest): StartRunResult {
    const key = runSlotKey(request.sourceId, request.slot);
    const runningRunId = this.running.get(key);
    if (runningRunId) return { ok: false, runningRunId };

    const terminal = request.mode === 'terminal' && !!this.deps.terminal;
    const run: ActionRun = {
      runId: randomUUID(),
      sourceId: request.sourceId,
      ...(request.slot ? { slot: request.slot } : {}),
      sourceKind: request.sourceKind,
      label: request.label,
      command: request.command,
      startedAt: this.now().toISOString(),
      stdout: '',
      stderr: '',
      mode: terminal ? 'terminal' : 'background',
      ...(terminal ? { tmuxSession: this.deps.terminal!.sessionNameFor(key) } : {}),
    };
    this.running.set(key, run.runId);
    this.remember(run);
    const live: LiveRun = { run, stdout: new OutputTail(), stderr: new OutputTail(), pending: { stdout: '', stderr: '' }, carried: { stdout: 0, stderr: 0 }, seq: 0, timer: null, cancelRequested: false };
    this.live.set(run.runId, live);
    this.deps.broadcast('action-run:started', { ...run });

    const cwd = request.cwd || this.deps.defaultCwd;
    if (terminal) {
      let markReady: () => void = () => {};
      live.terminalReady = new Promise<void>((resolve) => { markReady = resolve; });
      void this.executeInTerminal(live, cwd, markReady);
    } else {
      void this.execute(live, cwd, clampActionTimeout(request.timeoutSec) * 1000);
    }
    return { ok: true, run: { ...run } };
  }

  /** Stop a running run (and everything it spawned). False if unknown or already finished. */
  async cancel(runId: string): Promise<boolean> {
    const live = this.live.get(runId);
    if (!live || live.run.finishedAt) return false;
    live.cancelRequested = true;
    try {
      await live.cancel?.();
    } catch { /* the run ends on its own; the flag still marks it cancelled */ }
    return true;
  }

  /** Close the terminal of a finished terminal run. False if the run is not a terminal run. */
  async closeTerminal(runId: string): Promise<boolean> {
    const run = this.runs.find((r) => r.runId === runId);
    if (!run?.tmuxSession || !this.deps.terminal) return false;
    if (!run.finishedAt) return this.cancel(runId);
    // A newer run of the same source reuses the session name: never close it from an old run.
    if (this.running.has(runSlotKey(run.sourceId, run.slot))) return true;
    await this.deps.terminal.close(run.tmuxSession);
    return true;
  }

  /** Resolves once a running terminal run's tmux session exists; false if this is not one. */
  async terminalSession(runId: string): Promise<string | null> {
    const live = this.live.get(runId);
    if (!live?.run.tmuxSession || !live.terminalReady) {
      const run = this.runs.find((r) => r.runId === runId);
      return run?.tmuxSession && !run.finishedAt ? run.tmuxSession : null;
    }
    await live.terminalReady;
    return live.run.finishedAt ? null : live.run.tmuxSession;
  }

  list(sourceId?: string): ActionRun[] {
    const matching = sourceId ? this.runs.filter((r) => r.sourceId === sourceId) : this.runs;
    return matching.map((r) => ({ ...r }));
  }

  get(runId: string): ActionRun | undefined {
    const run = this.runs.find((r) => r.runId === runId);
    return run ? { ...run } : undefined;
  }

  /** Any of the source's commands in flight. */
  isRunning(sourceId: string): boolean {
    return [...this.running.keys()].some((key) => isSlotOf(key, sourceId));
  }

  private async execute(live: LiveRun, cwd: string, timeoutMs: number): Promise<void> {
    const { run } = live;
    try {
      const handle = this.deps.streamExec
        ? await this.deps.streamExec(run.command, { cwd, timeoutMs, onOutput: (stream, chunk) => this.onOutput(live, stream, chunk) })
        : null;
      if (handle) {
        live.cancel = () => handle.cancel();
        if (live.cancelRequested) void handle.cancel().catch(() => {});
        const outcome = await handle.done;
        run.exitCode = outcome.exitCode;
        if (outcome.timedOut) run.timedOut = true;
        if (outcome.cancelled || live.cancelRequested) run.cancelled = true;
        run.stdout = live.stdout.value();
        run.stderr = live.stderr.value();
      } else {
        // Gateway not restarted on this build: same run, output at the end only.
        if (this.deps.streamExec) run.liveUnavailable = true;
        const result = await this.deps.exec(run.command, { cwd, timeoutMs });
        run.exitCode = result.exitCode;
        run.stdout = truncateOutput(result.stdout ?? '');
        run.stderr = truncateOutput(result.stderr ?? '');
        if (result.timedOut) run.timedOut = true;
      }
    } catch (err) {
      // The gateway itself failed — there is no exit code to report.
      run.stdout = live.stdout.value();
      run.stderr = `${live.stderr.value()}${live.stderr.value() ? '\n' : ''}error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.finish(live);
    }
  }

  private async executeInTerminal(live: LiveRun, cwd: string, markReady: () => void): Promise<void> {
    const { run } = live;
    try {
      const handle = await this.deps.terminal!.start({ runId: run.runId, sourceId: run.sourceId, command: run.command, cwd, sessionName: run.tmuxSession! });
      live.cancel = () => handle.cancel();
      markReady();
      if (live.cancelRequested) void handle.cancel().catch(() => {});
      const outcome = await handle.done;
      run.exitCode = outcome.exitCode;
      run.stdout = truncateOutput(outcome.output);
      if (outcome.timedOut) run.timedOut = true;
      if (outcome.cancelled || live.cancelRequested) run.cancelled = true;
    } catch (err) {
      markReady();
      run.stderr = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this.finish(live);
    }
  }

  private onOutput(live: LiveRun, stream: 'stdout' | 'stderr', chunk: string): void {
    live[stream].append(chunk);
    live.pending[stream] += chunk;
    // Keep the pending buffer bounded too: only its tail can be sent anyway.
    if (live.pending[stream].length > OUTPUT_CHUNK_MAX_BYTES * 8) {
      const t = tail(live.pending[stream], OUTPUT_CHUNK_MAX_BYTES * 4);
      live.pending[stream] = t.text;
      live.carried[stream] += t.cut;
    }
    if (live.timer === null) {
      live.timer = (this.deps.setTimer ?? setTimeout)(() => {
        live.timer = null;
        this.flush(live);
      }, OUTPUT_FLUSH_MS);
    }
  }

  private flush(live: LiveRun): void {
    for (const stream of ['stdout', 'stderr'] as const) {
      const pending = live.pending[stream];
      if (!pending) continue;
      live.pending[stream] = '';
      const t = tail(pending, OUTPUT_CHUNK_MAX_BYTES);
      const dropped = t.cut + live.carried[stream];
      live.carried[stream] = 0;
      live.seq += 1;
      this.deps.broadcast('action-run:output', {
        runId: live.run.runId,
        sourceId: live.run.sourceId,
        stream,
        chunk: t.text,
        seq: live.seq,
        ...(dropped > 0 ? { dropped } : {}),
      });
    }
  }

  private finish(live: LiveRun): void {
    const { run } = live;
    if (live.timer !== null) {
      (this.deps.clearTimer ?? clearTimeout)(live.timer as ReturnType<typeof setTimeout>);
      live.timer = null;
    }
    this.flush(live);
    run.finishedAt = this.now().toISOString();
    this.running.delete(runSlotKey(run.sourceId, run.slot));
    this.live.delete(run.runId);
    this.deps.broadcast('action-run:finished', { ...run });
    this.deps.onFinished?.({ ...run });
  }

  /** Newest first; trims per source first, then overall. */
  private remember(run: ActionRun): void {
    this.runs.unshift(run);
    let seen = 0;
    for (let i = 0; i < this.runs.length; i += 1) {
      if (this.runs[i]!.sourceId !== run.sourceId) continue;
      seen += 1;
      if (seen > RUNS_PER_SOURCE) {
        this.runs.splice(i, 1);
        i -= 1;
      }
    }
    if (this.runs.length > RUNS_TOTAL) this.runs.length = RUNS_TOTAL;
  }

  private now(): Date {
    return this.deps.now ? this.deps.now() : new Date();
  }
}

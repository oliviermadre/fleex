import { randomUUID } from 'node:crypto';
import { ACTION_DEFAULT_TIMEOUT_SEC, ACTION_MAX_TIMEOUT_SEC } from '@fleex/shared';
import type { ActionRun, ActionRunRequest } from '@fleex/shared';

export const RUNS_PER_SOURCE = 20;
export const RUNS_TOTAL = 200;
export const RUN_OUTPUT_MAX_BYTES = 64 * 1024;

export type RunExecFn = (
  command: string,
  options: { cwd: string; timeoutMs: number },
) => Promise<{ stdout: string; stderr: string; exitCode: number; timedOut?: boolean }>;

export interface ActionRunDeps {
  exec: RunExecFn;
  /** Default cwd (the gateway user's home) when the request names none. */
  defaultCwd: string;
  broadcast: (type: 'action-run:started' | 'action-run:finished', data: ActionRun) => void;
  /** Called once a run ends — used to re-probe the icon it belongs to. */
  onFinished?: (run: ActionRun) => void;
  now?: () => Date;
}

export type StartRunResult = { ok: true; run: ActionRun } | { ok: false; runningRunId: string };

export function clampActionTimeout(sec: number | undefined): number {
  if (!Number.isFinite(sec) || !sec || sec <= 0) return ACTION_DEFAULT_TIMEOUT_SEC;
  // At least 1 s: a 0 would reach execFile as "no timeout" and lock the source forever.
  return Math.min(ACTION_MAX_TIMEOUT_SEC, Math.max(1, Math.round(sec)));
}

export function truncateOutput(text: string): string {
  if (Buffer.byteLength(text, 'utf8') <= RUN_OUTPUT_MAX_BYTES) return text;
  // Keep the tail: an error is usually at the end of the output.
  const buf = Buffer.from(text, 'utf8');
  return `…(truncated)\n${buf.subarray(buf.length - RUN_OUTPUT_MAX_BYTES).toString('utf8')}`;
}

/**
 * Runs pinned / workspace shell actions asynchronously and keeps their outcome.
 *
 * Before this, a click fired `/api/exec` and threw the result away — no exit
 * code, no output, and a 10 s kill that cut `gcloud auth login` short while it
 * waited on the browser. A run is now answered at once with an id, executes in
 * the background with a real timeout, and is announced on start and finish so
 * every tab can show a spinner, a toast and the logs.
 *
 * History is in memory only (20 per source, 200 overall): it is for "what did
 * that click just do", not an audit log, and losing it on restart is fine.
 */
export class ActionRunService {
  private readonly runs: ActionRun[] = [];
  private readonly running = new Map<string, string>();

  constructor(private readonly deps: ActionRunDeps) {}

  start(request: ActionRunRequest): StartRunResult {
    const runningRunId = this.running.get(request.sourceId);
    if (runningRunId) return { ok: false, runningRunId };

    const run: ActionRun = {
      runId: randomUUID(),
      sourceId: request.sourceId,
      sourceKind: request.sourceKind,
      label: request.label,
      command: request.command,
      startedAt: this.now().toISOString(),
      stdout: '',
      stderr: '',
    };
    this.running.set(request.sourceId, run.runId);
    this.remember(run);
    this.deps.broadcast('action-run:started', { ...run });

    const timeoutMs = clampActionTimeout(request.timeoutSec) * 1000;
    void this.execute(run, request.cwd || this.deps.defaultCwd, timeoutMs);
    return { ok: true, run: { ...run } };
  }

  list(sourceId?: string): ActionRun[] {
    const matching = sourceId ? this.runs.filter((r) => r.sourceId === sourceId) : this.runs;
    return matching.map((r) => ({ ...r }));
  }

  get(runId: string): ActionRun | undefined {
    const run = this.runs.find((r) => r.runId === runId);
    return run ? { ...run } : undefined;
  }

  isRunning(sourceId: string): boolean {
    return this.running.has(sourceId);
  }

  private async execute(run: ActionRun, cwd: string, timeoutMs: number): Promise<void> {
    try {
      const result = await this.deps.exec(run.command, { cwd, timeoutMs });
      run.exitCode = result.exitCode;
      run.stdout = truncateOutput(result.stdout ?? '');
      run.stderr = truncateOutput(result.stderr ?? '');
      if (result.timedOut) run.timedOut = true;
    } catch (err) {
      // The gateway itself failed — there is no exit code to report.
      run.stderr = `error: ${err instanceof Error ? err.message : String(err)}`;
    } finally {
      run.finishedAt = this.now().toISOString();
      this.running.delete(run.sourceId);
      this.deps.broadcast('action-run:finished', { ...run });
      this.deps.onFinished?.({ ...run });
    }
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

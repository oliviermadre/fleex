import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:os';
import { StringDecoder } from 'node:string_decoder';

/**
 * Streaming shell exec for actions: the output arrives as it is produced, and
 * the run can be stopped. The command runs in its own process group
 * (`detached`) so stopping it also stops what it spawned — `docker run`, a
 * pipeline, a script's children — not only the zsh in front.
 *
 * Wire format (NDJSON, one object per line):
 *   {"t":"start","execId":"…"}
 *   {"t":"out","d":"…"} | {"t":"err","d":"…"}
 *   {"t":"exit","code":0,"timedOut":false,"signal":null}
 */

export interface StreamExecRequest {
  command: string;
  cwd?: string;
  /** ms; 0/absent = no timeout. */
  timeout?: number;
}

export type StreamEvent =
  | { t: 'start'; execId: string }
  | { t: 'out' | 'err'; d: string }
  | { t: 'exit'; code: number; timedOut: boolean; cancelled: boolean; signal: string | null };

/** SIGTERM first; whatever is still alive this long after gets SIGKILL. */
export const KILL_GRACE_MS = 3_000;

interface RunningExec {
  child: ChildProcess;
  stopReason: 'timeout' | 'cancel' | null;
  killTimer: ReturnType<typeof setTimeout> | null;
}

const running = new Map<string, RunningExec>();

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal); // the whole group
  } catch {
    try { child.kill(signal); } catch { /* already gone */ }
  }
}

function stop(exec: RunningExec, reason: 'timeout' | 'cancel'): void {
  if (exec.stopReason) return;
  exec.stopReason = reason;
  signalGroup(exec.child, 'SIGTERM');
  exec.killTimer = setTimeout(() => signalGroup(exec.child, 'SIGKILL'), KILL_GRACE_MS);
}

export function startStreamExec(
  req: StreamExecRequest,
  emit: (event: StreamEvent) => void,
): { execId: string; done: Promise<void> } {
  const execId = randomUUID();
  const child = spawn('/bin/zsh', ['-l', '-c', req.command], {
    cwd: req.cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exec: RunningExec = { child, stopReason: null, killTimer: null };
  running.set(execId, exec);
  emit({ t: 'start', execId });

  // Multi-byte characters may straddle two chunks.
  const outDecoder = new StringDecoder('utf8');
  const errDecoder = new StringDecoder('utf8');
  child.stdout?.on('data', (b: Buffer) => { const d = outDecoder.write(b); if (d) emit({ t: 'out', d }); });
  child.stderr?.on('data', (b: Buffer) => { const d = errDecoder.write(b); if (d) emit({ t: 'err', d }); });

  const timer = req.timeout && req.timeout > 0 ? setTimeout(() => stop(exec, 'timeout'), req.timeout) : null;

  const done = new Promise<void>((resolve) => {
    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: string) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (exec.killTimer) clearTimeout(exec.killTimer);
      running.delete(execId);
      const tailOut = outDecoder.end();
      const tailErr = errDecoder.end();
      if (tailOut) emit({ t: 'out', d: tailOut });
      if (tailErr) emit({ t: 'err', d: tailErr });
      if (spawnError) emit({ t: 'err', d: spawnError });
      const signum = signal ? (constants.signals[signal] ?? 15) : 0;
      emit({
        t: 'exit',
        code: code ?? (signal ? 128 + signum : 1),
        timedOut: exec.stopReason === 'timeout',
        cancelled: exec.stopReason === 'cancel',
        signal,
      });
      resolve();
    };
    child.on('close', (code, signal) => finish(code, signal));
    child.on('error', (err) => finish(127, null, err.message));
  });

  return { execId, done };
}

/** Stop a running exec and its children. False if it is unknown or already finished. */
export function killExec(execId: string): boolean {
  const exec = running.get(execId);
  if (!exec) return false;
  stop(exec, 'cancel');
  return true;
}

/** NDJSON response body for Bun.serve; closing the connection stops the command. */
export function streamExecResponse(req: StreamExecRequest): Response {
  const encoder = new TextEncoder();
  let execId: string | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const handle = startStreamExec(req, (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch { /* client gone */ }
      });
      execId = handle.execId;
      void handle.done.then(() => {
        try { controller.close(); } catch { /* already closed */ }
      });
    },
    // The server stopped listening: nobody can see or stop this run any more.
    cancel() {
      if (execId) killExec(execId);
    },
  });
  return new Response(body, { headers: { 'content-type': 'application/x-ndjson' } });
}

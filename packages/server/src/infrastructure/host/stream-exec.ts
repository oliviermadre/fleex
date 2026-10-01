import http from 'node:http';
import https from 'node:https';
import { postJsonNoTimeout } from './remote.js';

/**
 * Client of the gateway's streaming exec (`/exec/stream`, NDJSON): output as it
 * is produced, a real exit code at the end, and `/exec/kill` to stop the run
 * and its whole process group.
 */

export class StreamExecUnavailableError extends Error {
  constructor() {
    super('The gateway has no streaming exec — restart it on this build');
  }
}

export interface StreamExecOutcome {
  exitCode: number;
  timedOut: boolean;
  cancelled: boolean;
}

export interface StreamExecHandle {
  /** Settles when the command exits; rejects if the gateway connection breaks first. */
  done: Promise<StreamExecOutcome>;
  cancel(): Promise<void>;
}

export type StreamShellExecFn = (
  command: string,
  options: { cwd: string; timeoutMs: number; onOutput: (stream: 'stdout' | 'stderr', chunk: string) => void },
) => Promise<StreamExecHandle>;

/** Splits a byte stream into JSON lines; a line may straddle two chunks, blank lines are skipped. */
export class NdjsonParser {
  private buffer = '';

  push(chunk: string): unknown[] {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() ?? '';
    const out: unknown[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed));
      } catch { /* a garbled line is skipped, the next ones still parse */ }
    }
    return out;
  }
}

type GatewayEvent =
  | { t: 'start'; execId: string }
  | { t: 'out' | 'err'; d: string }
  | { t: 'exit'; code: number; timedOut?: boolean; cancelled?: boolean };

export function remoteStreamShellExec(gatewayUrl: string): StreamShellExecFn {
  return (command, options) => new Promise<StreamExecHandle>((resolveHandle, rejectHandle) => {
    const target = new URL(`${gatewayUrl}/exec/stream`);
    const payload = JSON.stringify({ command, cwd: options.cwd, timeout: options.timeoutMs });
    const request = target.protocol === 'https:' ? https.request : http.request;

    let execId: string | null = null;
    let settleDone: { resolve: (o: StreamExecOutcome) => void; reject: (e: Error) => void } | null = null;
    const done = new Promise<StreamExecOutcome>((resolve, reject) => { settleDone = { resolve, reject }; });
    // Nobody may await `done` if the handle was never delivered.
    done.catch(() => {});
    let finished = false;
    const handle: StreamExecHandle = {
      done,
      cancel: async () => {
        if (execId && !finished) await postJsonNoTimeout(`${gatewayUrl}/exec/kill`, { execId });
      },
    };

    const req = request(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: 0,
    }, (res) => {
      if (res.statusCode === 404) {
        res.resume();
        rejectHandle(new StreamExecUnavailableError());
        return;
      }
      if (res.statusCode !== 200) {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => rejectHandle(new Error(`Gateway stream exec failed (${res.statusCode}): ${Buffer.concat(chunks).toString('utf8')}`)));
        return;
      }
      res.setEncoding('utf8');
      const parser = new NdjsonParser();
      res.on('data', (chunk: string) => {
        for (const raw of parser.push(chunk)) {
          const event = raw as GatewayEvent;
          if (event.t === 'start') {
            execId = event.execId;
            resolveHandle(handle);
          } else if (event.t === 'out') options.onOutput('stdout', event.d);
          else if (event.t === 'err') options.onOutput('stderr', event.d);
          else if (event.t === 'exit') {
            finished = true;
            settleDone?.resolve({ exitCode: event.code, timedOut: !!event.timedOut, cancelled: !!event.cancelled });
          }
        }
      });
      res.on('end', () => {
        if (!finished) settleDone?.reject(new Error('Gateway closed the stream before the command exited'));
      });
      res.on('error', (err) => settleDone?.reject(err));
    });
    req.on('error', (err) => {
      rejectHandle(err);
      settleDone?.reject(err);
    });
    req.end(payload);
  });
}

/**
 * Does the running gateway stream? An empty request costs nothing: a recent
 * gateway answers 400 (command required), an old one 404.
 */
export async function gatewayStreamsExec(gatewayUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${gatewayUrl}/exec/stream`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await res.body?.cancel().catch(() => {});
    return res.status !== 404;
  } catch {
    return false;
  }
}

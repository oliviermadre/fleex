/**
 * Executes a generated tool by running the real `fleex` CLI.
 *
 * Uses `execFile` with an argv array — never a shell — so there is no command
 * injection surface and multi-line values (page content as `--description`,
 * etc.) pass through untouched. The binary is fixed; the model only ever
 * supplies arguments, never the command to run.
 */
import { execFile } from 'node:child_process';
import { buildArgv, type BuildArgvOptions } from './argv.ts';
import type { GeneratedTool } from './types.ts';

export interface ExecOptions extends BuildArgvOptions {
  /** Executable to run. Default: $FLEEX_BIN or `fleex`. */
  bin?: string;
  /** Args prepended before the fleex argv (e.g. ['run', '/repo/packages/cli/index.ts'] for bun). */
  prefixArgs?: string[];
  cwd?: string;
  /** Hard timeout; the child is killed past this. Default 30s. */
  timeoutMs?: number;
  /** Max stdout/stderr bytes captured. Default 16 MiB. */
  maxBuffer?: number;
}

/** Why a run failed, beyond the bare exit code. */
export type ExecFailureKind = 'exit' | 'timeout' | 'signal' | 'spawn' | 'output-limit';

export interface ExecFailure {
  kind: ExecFailureKind;
  /** Short human-readable reason (no argv), e.g. `killed after 30000 ms timeout (SIGTERM)`. */
  detail: string;
}

export interface ExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed stdout when `--json` was requested and output was valid JSON. */
  data?: unknown;
  /** The fleex argv (without the binary) — for display, audit, and gating. */
  argv: string[];
  /** Set only when `ok` is false: the classified reason, so callers never see a bare code. */
  failure?: ExecFailure;
}

interface ExecFileError {
  code?: unknown;
  killed?: boolean;
  signal?: NodeJS.Signals | null;
  message?: string;
}

/**
 * Classify an `execFile` error. Timeout, signal and spawn failures leave stderr
 * empty and a non-numeric `code`, so without this the only trace of *why* the
 * process failed (`err.message`) was discarded. Same shape under Bun and Node.
 */
export function classifyExecError(
  err: ExecFileError,
  ctx: { bin: string; timeoutMs: number; maxBuffer: number },
): { exitCode: number; failure: ExecFailure } {
  if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' || /maxBuffer/i.test(err.message ?? '')) {
    return { exitCode: 1, failure: { kind: 'output-limit', detail: `output exceeded ${ctx.maxBuffer} bytes` } };
  }
  if (err.killed && err.signal) {
    return {
      exitCode: 1,
      failure: { kind: 'timeout', detail: `killed after ${ctx.timeoutMs} ms timeout (${err.signal})` },
    };
  }
  if (err.signal) {
    return { exitCode: 1, failure: { kind: 'signal', detail: `killed by ${err.signal}` } };
  }
  if (typeof err.code === 'string') {
    return { exitCode: 1, failure: { kind: 'spawn', detail: `could not start ${ctx.bin}: ${err.code}` } };
  }
  const code = typeof err.code === 'number' ? err.code : 1;
  return { exitCode: code, failure: { kind: 'exit', detail: `exited with code ${code}` } };
}

/** Resolve the default fleex invocation (binary + prefix args). */
export function resolveFleexBin(opts: ExecOptions = {}): { bin: string; prefixArgs: string[] } {
  return {
    bin: opts.bin ?? process.env.FLEEX_BIN ?? 'fleex',
    prefixArgs: opts.prefixArgs ?? [],
  };
}

/** Run a raw fleex argv. Resolves (never rejects) with a structured result. */
export function runFleexArgv(argv: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const { bin, prefixArgs } = resolveFleexBin(opts);
  const fullArgs = [...prefixArgs, ...argv];
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const maxBuffer = opts.maxBuffer ?? 16 * 1024 * 1024;
  return new Promise((resolve) => {
    execFile(
      bin,
      fullArgs,
      { cwd: opts.cwd, timeout: timeoutMs, maxBuffer, windowsHide: true },
      (err, stdout, stderr) => {
        const classified = err ? classifyExecError(err as ExecFileError, { bin, timeoutMs, maxBuffer }) : null;
        const exitCode = classified ? classified.exitCode : 0;
        const result: ExecResult = {
          ok: exitCode === 0,
          exitCode,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          argv,
        };
        if (classified && exitCode !== 0) result.failure = classified.failure;
        if (opts.json && result.stdout.trim()) {
          try {
            result.data = JSON.parse(result.stdout);
          } catch {
            // Leave data undefined; caller falls back to raw stdout.
          }
        }
        resolve(result);
      },
    );
  });
}

/** Build argv for a tool from its input, then execute it. */
export function execFleex(
  tool: GeneratedTool,
  input: Record<string, unknown>,
  opts: ExecOptions = {},
): Promise<ExecResult> {
  const argv = buildArgv(tool, input, opts);
  return runFleexArgv(argv, opts);
}

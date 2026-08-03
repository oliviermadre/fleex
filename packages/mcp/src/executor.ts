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

export interface ExecResult {
  ok: boolean;
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Parsed stdout when `--json` was requested and output was valid JSON. */
  data?: unknown;
  /** The fleex argv (without the binary) — for display, audit, and gating. */
  argv: string[];
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
  return new Promise((resolve) => {
    execFile(
      bin,
      fullArgs,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 30_000,
        maxBuffer: opts.maxBuffer ?? 16 * 1024 * 1024,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const exitCode =
          err && typeof (err as { code?: unknown }).code === 'number'
            ? (err as { code: number }).code
            : err
              ? 1
              : 0;
        const result: ExecResult = {
          ok: exitCode === 0,
          exitCode,
          stdout: stdout ?? '',
          stderr: stderr ?? '',
          argv,
        };
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

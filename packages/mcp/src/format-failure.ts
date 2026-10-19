/**
 * Turns a failed CLI run into the text an MCP / side-panel caller receives.
 *
 * The caller is an LLM: it never sees the terminal, so this text is its only
 * way to learn *what* failed and *why*. Shape, always:
 *
 *   fleex <command path> failed: <reason>
 *   <stdout, capped>
 *   stderr:            ← only when stdout is present too
 *   <stderr, capped>
 *
 * The status line is first so the reason survives even if the caller truncates.
 */
import type { ExecResult } from './executor.ts';

/** Per-stream cap. #321 keeps parse errors ≤ 5 lines; a Bun stack is ~10–15. */
export const FAILURE_MAX_LINES = 20;
export const FAILURE_MAX_CHARS = 2000;

const ANSI = /\x1b\[[0-9;]*m/g;

/** Keep the head (the cause is at the top), then say how much was cut. */
function cap(text: string): string {
  const lines = text.split('\n');
  let marker: string | null = null;
  let body = text;
  if (lines.length > FAILURE_MAX_LINES) {
    marker = `… (${lines.length - FAILURE_MAX_LINES} more lines truncated)`;
    body = lines.slice(0, FAILURE_MAX_LINES).join('\n');
  }
  if (body.length > FAILURE_MAX_CHARS) {
    const extra = body.length - FAILURE_MAX_CHARS;
    body = body.slice(0, FAILURE_MAX_CHARS);
    marker ??= `… (${extra} more chars truncated)`;
  }
  return marker ? `${body}\n${marker}` : body;
}

export function formatExecFailure(res: ExecResult, commandPath: string[]): string {
  const stdout = res.stdout.replace(ANSI, '').trim();
  let stderr = res.stderr.replace(ANSI, '').trim();
  if (stderr === stdout) stderr = '';

  const status = res.failure?.detail ?? `exited with code ${res.exitCode}`;
  const parts = [`fleex ${commandPath.join(' ')} failed: ${status}`];
  if (stdout) parts.push(cap(stdout));
  if (stderr) {
    if (stdout) parts.push('stderr:');
    parts.push(cap(stderr));
  }
  return parts.join('\n');
}

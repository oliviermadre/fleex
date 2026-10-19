import { describe, it, expect } from 'vitest';
import { formatExecFailure, FAILURE_MAX_LINES, FAILURE_MAX_CHARS } from '../src/format-failure.ts';
import type { ExecResult } from '../src/executor.ts';

const CMD = ['memory', 'ask'];
const fail = (r: Partial<ExecResult>): ExecResult => ({ ok: false, exitCode: 1, stdout: '', stderr: '', argv: [], ...r });

// The caller is an LLM that never sees the terminal: this text is all it gets to
// decide what to do next. A bare "exited with code 1" is what made #694 a
// non-bug investigated for $6.87.
describe('formatExecFailure', () => {
  it('leads with the command and reason, then stderr unlabelled when it is the only stream', () => {
    const text = formatExecFailure(fail({ stderr: "error: unknown option '--subject'\n" }), CMD);
    expect(text).toBe("fleex memory ask failed: exited with code 1\nerror: unknown option '--subject'");
  });

  it('keeps BOTH streams and the real exit code when stdout and stderr are set', () => {
    const text = formatExecFailure(
      fail({ exitCode: 2, stdout: 'partial progress', stderr: 'Error: ECONNREFUSED 127.0.0.1:3000' }),
      CMD,
    );
    expect(text).toBe(
      'fleex memory ask failed: exited with code 2\npartial progress\nstderr:\nError: ECONNREFUSED 127.0.0.1:3000',
    );
  });

  it('uses the classified reason when the process left no output at all', () => {
    const text = formatExecFailure(
      fail({ failure: { kind: 'timeout', detail: 'killed after 50 ms timeout (SIGTERM)' } }),
      CMD,
    );
    expect(text).toBe('fleex memory ask failed: killed after 50 ms timeout (SIGTERM)');
    expect(text).not.toContain('exited with code');
  });

  it('caps a long stream to its head and says how much was cut', () => {
    const stderr = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const lines = formatExecFailure(fail({ stderr }), CMD).split('\n');
    expect(lines).toHaveLength(1 + FAILURE_MAX_LINES + 1);
    expect(lines[1]).toBe('line 0'); // the cause is at the top: keep it
    expect(lines.at(-1)).toBe('… (180 more lines truncated)');
  });

  it('caps a single huge line by characters', () => {
    const text = formatExecFailure(fail({ stderr: 'x'.repeat(10_000) }), CMD);
    const [, body, marker] = text.split('\n');
    expect(body).toHaveLength(FAILURE_MAX_CHARS);
    expect(marker).toBe('… (8000 more chars truncated)');
  });

  it('shows identical stdout and stderr only once', () => {
    const text = formatExecFailure(fail({ stdout: 'Error: boom\n', stderr: 'Error: boom' }), CMD);
    expect(text).toBe('fleex memory ask failed: exited with code 1\nError: boom');
  });

  it('strips ANSI colour codes — an MCP caller is not a terminal', () => {
    const text = formatExecFailure(fail({ stderr: '\x1b[31merror:\x1b[0m unknown option \x1b[1m--x\x1b[0m' }), CMD);
    expect(text).toContain('error: unknown option --x');
    expect(text).not.toContain('\x1b');
  });
});

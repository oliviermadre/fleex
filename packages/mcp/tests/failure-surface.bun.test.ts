/**
 * End-to-end guard: every failure a caller can hit through the bridge must come
 * back with enough text for an LLM to correct itself — never a bare
 * "exited with code 1", never a silent success on an ignored field.
 *
 * Runs the REAL CLI tree and real processes under Bun (the MCP server runtime).
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { buildProgram } from '@fleex/cli/program';
import { generateTools } from '../src/generator.ts';
import { buildArgv } from '../src/argv.ts';
import { runFleexArgv, type ExecOptions } from '../src/executor.ts';
import { callToolResult } from '../src/mcp-handlers.ts';
import type { GeneratedTool } from '../src/types.ts';

const tools = generateTools(await buildProgram());
const tool = (name: string): GeneratedTool => tools.find((t) => t.name === name)!;
const CLI = fileURLToPath(new URL('../../cli/index.ts', import.meta.url));
const realCli: ExecOptions = { bin: process.execPath, prefixArgs: [CLI] };
const text = (r: { content: Array<{ text: string }> }): string => r.content[0]!.text;

describe('process failures carry their reason (real process, Bun)', () => {
  it('timeout', async () => {
    const res = await callToolResult(tools, 'fleex_memory_ask', { question: ['x'] }, {
      execOpts: { bin: process.execPath, prefixArgs: ['-e', 'setTimeout(() => {}, 5000)', '--'], timeoutMs: 50 },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toBe('fleex memory ask failed: killed after 50 ms timeout (SIGTERM)');
  });

  it('binary that cannot start', async () => {
    const res = await callToolResult(tools, 'fleex_memory_ask', { question: ['x'] }, {
      execOpts: { bin: '/nonexistent/fleex' },
    });
    expect(text(res)).toBe('fleex memory ask failed: could not start /nonexistent/fleex: ENOENT');
  });

  it('real exit code and both streams', async () => {
    const res = await runFleexArgv([], {
      bin: process.execPath,
      prefixArgs: ['-e', 'console.log("out"); console.error("err"); process.exit(3)'],
    });
    expect(res).toMatchObject({ ok: false, exitCode: 3, stdout: 'out\n', stderr: 'err\n', failure: { kind: 'exit' } });
  });
});

describe('CLI errors reach the caller (real CLI)', () => {
  it('a parse error keeps the CLI hint, Try: line included', async () => {
    // Force an argv the schema can no longer produce, to simulate version drift.
    const res = await callToolResult(tools, 'fleex_memory_compile', { subject: ['foo'] }, {
      execOpts: realCli,
      exec: (t, input, opts) => runFleexArgv([...buildArgv(t, input, opts), '--subject', 'foo'], opts),
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/^fleex memory compile failed: exited with code 1\n/);
    expect(text(res)).toContain('is not an option');
    expect(text(res)).toContain('Try:');
  });

  it('an application error ({"ok":false} on stdout) arrives under the status line', async () => {
    // An unknown workspace fails deterministically, whether a stack runs or not.
    // The exact wording depends on the host: "workspace '…' not found" when
    // ~/.fleex/workspaces.json exists, "… does not exist" on a fresh machine (CI).
    // Both are application errors on stdout — that is what this test is about.
    const res = await callToolResult(tools, 'fleex_memory_ask', { question: ['x'] }, {
      execOpts: { ...realCli, workspace: 'zz-no-such-workspace-695' },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/^fleex memory ask failed: exited with code 1\n\{"ok":false,"error":"[^"]*'zz-no-such-workspace-695'/);
  });
});

describe('unknown fields are rejected on the real tool surface', () => {
  it('state → status, with the full accepted list', () => {
    expect(() => buildArgv(tool('fleex_ticket_list'), { state: 'doing' })).toThrow(
      'unknown field "state" for fleex_ticket_list — did you mean "status"?\n' +
        `accepted fields: ${tool('fleex_ticket_list').options.map((o) => o.key).join(', ')}`,
    );
  });

  it('repository → repo', () => {
    expect(() => buildArgv(tool('fleex_memory_ask'), { question: ['q'], repository: 'o/r' })).toThrow(
      /unknown field "repository" for fleex_memory_ask — did you mean "repo"\?/,
    );
  });

  it('via MCP: isError, and no process is spawned', async () => {
    let spawned = false;
    const res = await callToolResult(tools, 'fleex_ticket_list', { state: 'doing' }, {
      execOpts: realCli,
      exec: (t, input, opts) => {
        const argv = buildArgv(t, input, opts); // the real gate
        spawned = true;
        return runFleexArgv(argv, opts);
      },
    });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('did you mean "status"?');
    expect(spawned).toBe(false);
  });

  // No false positive: every key a tool publishes must be accepted.
  it.each(tools.map((t) => [t.name, t] as const))('%s accepts every key of its own schema', (_n, t) => {
    const input: Record<string, unknown> = {};
    for (const a of t.arguments) input[a.key] = a.variadic ? ['x'] : 'x';
    for (const o of t.options) {
      input[o.key] = o.takesValue ? (o.variadic ? ['v'] : 'v') : o.negateOnly ? false : true;
    }
    expect(Object.keys(input).sort()).toEqual(Object.keys(t.inputSchema.properties).sort());
    expect(() => buildArgv(t, input)).not.toThrow(/unknown field/);
  });
});

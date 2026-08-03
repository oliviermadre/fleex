import { Command } from 'commander';
import { describe, it, expect } from 'vitest';

import { execFleex, runFleexArgv, DEFAULT_TIMEOUT_MS } from '../src/executor.ts';
import { generateTools } from '../src/generator.ts';

import type { GeneratedTool } from '../src/types.ts';

// Use the current node binary as a stand-in for `fleex`, echoing its argv so we
// can assert the executor passes arguments literally — no shell, no mangling.
const NODE = process.execPath;
const ECHO_ARGV = ['-e', 'console.log(JSON.stringify(process.argv.slice(1)))'];

function createTool(): GeneratedTool {
  const root = new Command('fleex');
  const ticket = root.command('ticket');
  const create = ticket.command('create').description('Create');
  create.requiredOption('--title <t>', 'title');
  create.option('--description <d>', 'desc');
  create.option('--workspace <name>', 'ws');
  return generateTools(root).find((t) => t.name === 'fleex_ticket_create')!;
}

describe('runFleexArgv', () => {
  it('passes argv literally, with no shell interpretation', async () => {
    const argv = ['ticket', 'create', '--title', 'a; rm -rf / && echo $HOME'];
    const res = await runFleexArgv(argv, { bin: NODE, prefixArgs: ECHO_ARGV });
    expect(res.ok).toBe(true);
    expect(res.exitCode).toBe(0);
    // The dangerous-looking string is one inert argv element — never evaluated.
    expect(JSON.parse(res.stdout)).toEqual(argv);
  });

  it('preserves multi-line values intact', async () => {
    const argv = ['ticket', 'create', '--description', '# Title\n\n- a\n- b'];
    const res = await runFleexArgv(argv, { bin: NODE, prefixArgs: ECHO_ARGV });
    expect(JSON.parse(res.stdout)[3]).toBe('# Title\n\n- a\n- b');
  });

  it('captures a non-zero exit code without throwing', async () => {
    const res = await runFleexArgv(['x'], { bin: NODE, prefixArgs: ['-e', 'process.exit(3)'] });
    expect(res.ok).toBe(false);
    expect(res.exitCode).toBe(3);
  });

  it('parses JSON stdout when json is requested', async () => {
    const res = await runFleexArgv([], {
      bin: NODE,
      prefixArgs: ['-e', 'console.log(JSON.stringify({ displayId: 42, status: "backlog" }))'],
      json: true,
    });
    expect(res.data).toEqual({ displayId: 42, status: 'backlog' });
  });
});

describe('execFleex', () => {
  it('builds argv from tool input then runs it', async () => {
    const tool = createTool();
    const res = await execFleex(
      tool,
      { title: 'Fix bug', description: 'multi\nline' },
      { bin: NODE, prefixArgs: ECHO_ARGV, workspace: 'acme' },
    );
    expect(JSON.parse(res.stdout)).toEqual([
      'ticket',
      'create',
      '--title',
      'Fix bug',
      '--description',
      'multi\nline',
      '--workspace',
      'acme',
    ]);
  });

  it('reports a timeout as such, not as a bogus exit code', async () => {
    // Without this the model is told "fleex exited with code 1" and may retry a
    // command that in fact needs a longer budget.
    const res = await runFleexArgv([], {
      bin: NODE,
      prefixArgs: ['-e', 'setTimeout(() => {}, 5000)'],
      timeoutMs: 100,
    });
    expect(res.ok).toBe(false);
    expect(res.timedOut).toBe(true);
    expect(res.timeoutMs).toBe(100);
  });

  it('reports the applied budget on a normal run', async () => {
    const res = await runFleexArgv([], { bin: NODE, prefixArgs: ['-e', ''] });
    expect(res.timedOut).toBeUndefined();
    expect(res.timeoutMs).toBe(DEFAULT_TIMEOUT_MS);
  });

  it('emits no --workspace for an empty workspace (never --workspace "")', async () => {
    const tool = createTool();
    const res = await execFleex(
      tool,
      { title: 'Fix bug' },
      { bin: NODE, prefixArgs: ECHO_ARGV, workspace: '' },
    );
    const argv = JSON.parse(res.stdout) as string[];
    expect(argv).not.toContain('--workspace');
    expect(argv).toEqual(['ticket', 'create', '--title', 'Fix bug']);
  });

  it('lets a command declare a budget that outranks the ambient one', async () => {
    // A per-command budget is a deliberate statement about that command; the
    // ambient default is only a fallback, so it must not shorten it.
    const tool = { ...createTool(), timeoutMs: 5_000 };
    const res = await execFleex(
      tool,
      { title: 'x' },
      { bin: NODE, prefixArgs: ECHO_ARGV, timeoutMs: 100 },
    );
    expect(res.timeoutMs).toBe(5_000);

    const ambient = await execFleex(
      createTool(),
      { title: 'x' },
      { bin: NODE, prefixArgs: ECHO_ARGV, timeoutMs: 7_000 },
    );
    expect(ambient.timeoutMs).toBe(7_000);
  });
});

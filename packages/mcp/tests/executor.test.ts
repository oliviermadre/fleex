import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { generateTools } from '../src/generator.ts';
import { classifyExecError, execFleex, runFleexArgv } from '../src/executor.ts';
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
      'ticket', 'create',
      '--title', 'Fix bug',
      '--description', 'multi\nline',
      '--workspace', 'acme',
    ]);
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
});

describe('classifyExecError', () => {
  const ctx = { bin: '/nope/fleex', timeoutMs: 50, maxBuffer: 100 };

  // exitCode keeps its historical value (1 for every non-numeric failure) so no
  // existing caller breaks; the reason moves to `failure` instead of being lost.
  it.each([
    [{ code: null, killed: true, signal: 'SIGTERM' as const }, 1, 'timeout', 'killed after 50 ms timeout (SIGTERM)'],
    [{ code: null, killed: false, signal: 'SIGKILL' as const }, 1, 'signal', 'killed by SIGKILL'],
    [{ code: 'ENOENT' }, 1, 'spawn', 'could not start /nope/fleex: ENOENT'],
    [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 1, 'output-limit', 'output exceeded 100 bytes'],
    [{ code: 3, killed: false, signal: null }, 3, 'exit', 'exited with code 3'],
  ])('%o → exit %i, %s', (err, exitCode, kind, detail) => {
    expect(classifyExecError(err, ctx)).toEqual({ exitCode, failure: { kind, detail } });
  });
});

describe('runFleexArgv failure reasons', () => {
  it('reports a timeout instead of a bare exit code', async () => {
    const res = await runFleexArgv([], { bin: NODE, prefixArgs: ['-e', 'setTimeout(() => {}, 5000)'], timeoutMs: 50 });
    expect(res).toMatchObject({ ok: false, exitCode: 1, failure: { kind: 'timeout' } });
  });

  it('reports a binary that cannot start', async () => {
    const res = await runFleexArgv([], { bin: '/nonexistent/fleex' });
    expect(res).toMatchObject({ ok: false, exitCode: 1, failure: { kind: 'spawn' } });
    expect(res.failure!.detail).toContain('ENOENT');
  });

  it('leaves failure unset on success', async () => {
    const res = await runFleexArgv([], { bin: NODE, prefixArgs: ['-e', ''] });
    expect(res.ok).toBe(true);
    expect(res.failure).toBeUndefined();
  });
});

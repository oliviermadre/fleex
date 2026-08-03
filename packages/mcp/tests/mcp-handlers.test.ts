import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { generateTools } from '../src/generator.ts';
import { listTools, callToolResult, toMcpTool, resultText } from '../src/mcp-handlers.ts';
import type { ExecResult } from '../src/executor.ts';

function fakeProgram(): Command {
  const root = new Command('fleex');
  const ticket = root.command('ticket').description('Manage tickets');
  ticket.command('list').description('List tickets').option('--status <s>', 'status');
  ticket.command('create').description('Create a ticket').requiredOption('--title <t>', 'title');
  ticket.command('delete').description('Delete a ticket').argument('<id>', 'id')
    .option('-f, --force', 'Skip confirmation');
  ticket.command('comment-delete').description('Delete a comment').argument('<id>', 'id');
  ticket.command('update').description('Update a ticket').argument('<id>', 'id');
  return root;
}

const tools = generateTools(fakeProgram());

describe('listTools', () => {
  it('maps every tool with schema and annotations', () => {
    const { tools: list } = listTools(tools);
    const names = list.map((t) => t.name).sort();
    expect(names).toEqual([
      'fleex_ticket_comment_delete',
      'fleex_ticket_create',
      'fleex_ticket_delete',
      'fleex_ticket_list',
      'fleex_ticket_update',
    ]);

    const list2 = list.find((t) => t.name === 'fleex_ticket_list')!;
    expect(list2.annotations.readOnlyHint).toBe(true);
    expect(list2.annotations.destructiveHint).toBe(false);
    expect(list2.inputSchema.type).toBe('object');

    const create = list.find((t) => t.name === 'fleex_ticket_create')!;
    expect(create.annotations.readOnlyHint).toBe(false);
    expect(create.annotations.destructiveHint).toBe(false);

    const del = list.find((t) => t.name === 'fleex_ticket_delete')!;
    expect(del.annotations.readOnlyHint).toBe(false);
    expect(del.annotations.destructiveHint).toBe(true);
  });

  it('sees the verb inside a hyphenated leaf', () => {
    // `comment-delete` destroys a comment; matching the leaf name whole missed
    // it and advertised the tool as read-only.
    const { tools: list } = listTools(tools);
    const commentDelete = list.find((t) => t.name === 'fleex_ticket_comment_delete')!;
    expect(commentDelete.annotations.readOnlyHint).toBe(false);
    expect(commentDelete.annotations.destructiveHint).toBe(true);
  });
});

describe('toMcpTool', () => {
  it('titles the tool with the full command path', () => {
    const tool = tools.find((t) => t.name === 'fleex_ticket_create')!;
    expect(toMcpTool(tool).annotations.title).toBe('fleex ticket create');
  });
});

describe('resultText', () => {
  it('names the timeout instead of blaming a bogus exit code', () => {
    // execFile kills the child without an exit code, so the generic branch
    // reports "exited with code 1" — a message that lies about the cause.
    const res: ExecResult = {
      ok: false, exitCode: 1, stdout: '', stderr: '', argv: ['ticket', 'link', '42'],
      timedOut: true, timeoutMs: 30_000,
    };
    expect(resultText(res)).toContain('timed out');
    expect(resultText(res)).toContain('30000');
    expect(resultText(res)).not.toContain('exited with code');
  });
});

describe('callToolResult', () => {
  const okExec = async (): Promise<ExecResult> => ({
    ok: true, exitCode: 0, stdout: '{"displayId":42}', stderr: '', data: { displayId: 42 }, argv: [], timeoutMs: 30_000,
  });
  const failExec = async (): Promise<ExecResult> => ({
    ok: false, exitCode: 1, stdout: '', stderr: 'Stack not running', argv: [], timeoutMs: 30_000,
  });

  it('returns parsed JSON data as pretty text on success', async () => {
    const res = await callToolResult(tools, 'fleex_ticket_create', { title: 'x' }, { exec: okExec });
    expect(res.isError).toBe(false);
    expect(JSON.parse(res.content[0]!.text)).toEqual({ displayId: 42 });
  });

  it('surfaces CLI failure as an error result with stderr', async () => {
    const res = await callToolResult(tools, 'fleex_ticket_list', {}, { exec: failExec });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('Stack not running');
  });

  it('reports unknown tools as an error', async () => {
    const res = await callToolResult(tools, 'fleex_nope', {}, { exec: okExec });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('Unknown tool');
  });

  it('forces --json on via the exec options', async () => {
    let seenJson: boolean | undefined;
    const spyExec = async (_t: unknown, _i: unknown, opts: { json?: boolean }): Promise<ExecResult> => {
      seenJson = opts.json;
      return { ok: true, exitCode: 0, stdout: 'OK', stderr: '', argv: [], timeoutMs: 30_000 };
    };
    await callToolResult(tools, 'fleex_ticket_list', {}, { exec: spyExec as never });
    expect(seenJson).toBe(true);
  });
});

describe('callToolResult confirmation gate', () => {
  /** Records whether the CLI was reached, and with which options. */
  function spy() {
    const calls: Array<{ assumeYes?: boolean }> = [];
    const exec = async (_t: unknown, _i: unknown, opts: { assumeYes?: boolean }): Promise<ExecResult> => {
      calls.push({ assumeYes: opts.assumeYes });
      return { ok: true, exitCode: 0, stdout: 'OK', stderr: '', argv: [], timeoutMs: 30_000 };
    };
    return { calls, exec: exec as never };
  }

  it('refuses a tool that would block on a prompt nobody can answer', async () => {
    // A stdio server owns stdin for the protocol, so the CLI's readline would
    // hang until the exec timeout. Refusing immediately says why, and — the
    // point — no destructive process is started.
    const { calls, exec } = spy();
    const res = await callToolResult(tools, 'fleex_ticket_delete', { id: '5' }, { exec });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('--assume-yes');
    expect(calls).toEqual([]);
  });

  it('runs and forwards assumeYes once the client owns approval', async () => {
    const { calls, exec } = spy();
    const res = await callToolResult(tools, 'fleex_ticket_delete', { id: '5' }, { exec, assumeYes: true });
    expect(res.isError).toBe(false);
    expect(calls).toEqual([{ assumeYes: true }]);
  });

  it('leaves tools without a confirmation prompt alone', async () => {
    // Only the handful of commands carrying --force are affected; a plain
    // write must not become unusable on a default stdio server.
    const { calls, exec } = spy();
    const res = await callToolResult(tools, 'fleex_ticket_update', { id: '5' }, { exec });
    expect(res.isError).toBe(false);
    expect(calls).toEqual([{ assumeYes: false }]);
  });
});

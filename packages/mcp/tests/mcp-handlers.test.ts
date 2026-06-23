import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { generateTools } from '../src/generator.ts';
import { listTools, callToolResult, toMcpTool } from '../src/mcp-handlers.ts';
import type { ExecResult } from '../src/executor.ts';

function fakeProgram(): Command {
  const root = new Command('fleex');
  const ticket = root.command('ticket').description('Manage tickets');
  ticket.command('list').description('List tickets').option('--status <s>', 'status');
  ticket.command('create').description('Create a ticket').requiredOption('--title <t>', 'title');
  ticket.command('delete').description('Delete a ticket').argument('<id>', 'id');
  return root;
}

const tools = generateTools(fakeProgram());

describe('listTools', () => {
  it('maps every tool with schema and annotations', () => {
    const { tools: list } = listTools(tools);
    const names = list.map((t) => t.name).sort();
    expect(names).toEqual(['fleex_ticket_create', 'fleex_ticket_delete', 'fleex_ticket_list']);

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
});

describe('toMcpTool', () => {
  it('titles the tool with the full command path', () => {
    const tool = tools.find((t) => t.name === 'fleex_ticket_create')!;
    expect(toMcpTool(tool).annotations.title).toBe('fleex ticket create');
  });
});

describe('callToolResult', () => {
  const okExec = async (): Promise<ExecResult> => ({
    ok: true, exitCode: 0, stdout: '{"displayId":42}', stderr: '', data: { displayId: 42 }, argv: [],
  });
  const failExec = async (): Promise<ExecResult> => ({
    ok: false, exitCode: 1, stdout: '', stderr: 'Stack not running', argv: [],
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
      return { ok: true, exitCode: 0, stdout: 'OK', stderr: '', argv: [] };
    };
    await callToolResult(tools, 'fleex_ticket_list', {}, { exec: spyExec as never });
    expect(seenJson).toBe(true);
  });
});

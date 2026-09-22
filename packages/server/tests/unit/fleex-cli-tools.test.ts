import { describe, it, expect } from 'vitest';
import { buildCliTools, cliToolArgv, parseFlags, type CliCommandDoc } from '../../src/application/assistant/fleex-cli-tools.js';

const docs: CliCommandDoc[] = [
  { path: 'fleex ticket', description: 'group', arguments: [], options: [], subcommands: ['show', 'update', 'delete'] },
  { path: 'fleex ticket show', description: 'Show ticket', subcommands: [],
    arguments: [{ name: 'id', description: 'Ticket id', required: true, variadic: false }],
    options: [
      { flags: '--board <board>', description: 'Board', required: true, mandatory: false },
      { flags: '--full', description: 'Everything', required: false, mandatory: false },
      { flags: '--json', description: 'json', required: false, mandatory: false },
      { flags: '--workspace <name>', description: 'ws', required: true, mandatory: false },
    ] },
  { path: 'fleex ticket update', description: 'Update', subcommands: [],
    arguments: [{ name: 'id', description: 'id', required: true, variadic: false }],
    options: [{ flags: '-s, --status <status>', description: 'status', required: true, mandatory: false }] },
  { path: 'fleex ticket delete', description: 'Delete', subcommands: [], arguments: [{ name: 'id', description: 'id', required: true, variadic: false }], options: [] },
  { path: 'fleex self-update', description: 'nope', subcommands: [], arguments: [], options: [] },
  { path: 'fleex ticket tag add', description: 'Add tags', subcommands: [],
    arguments: [{ name: 'id', description: 'id', required: true, variadic: false }, { name: 'tags', description: 'tags', required: true, variadic: true }], options: [] },
];

describe('buildCliTools', () => {
  it('exposes leaf commands under the allowed roots, never destructive ones nor groups', () => {
    const names = buildCliTools(docs).map((t) => t.name);
    expect(names).toEqual(['fleex_ticket_show', 'fleex_ticket_update', 'fleex_ticket_tag_add']);
  });
  it('derives the input schema from positionals and options, hiding --json/--workspace', () => {
    const show = buildCliTools(docs).find((t) => t.name === 'fleex_ticket_show')!;
    expect(Object.keys(show.inputSchema.properties)).toEqual(['id', 'board', 'full']);
    expect(show.inputSchema.required).toEqual(['id']);
    expect(show.mutating).toBe(false);
    expect(buildCliTools(docs).find((t) => t.name === 'fleex_ticket_update')!.mutating).toBe(true);
  });
});

describe('cliToolArgv', () => {
  const tools = buildCliTools(docs);
  it('rebuilds the argv with workspace and json when the command accepts them', () => {
    const show = tools.find((t) => t.name === 'fleex_ticket_show')!;
    expect(cliToolArgv(show, { id: '42', full: true, board: 'Personal' }, 'qa')).toEqual(['ticket', 'show', '42', '--board', 'Personal', '--full', '--workspace', 'qa', '--json']);
    expect(cliToolArgv(show, { id: '42' }, null)).toEqual(['ticket', 'show', '42', '--json']);
  });
  it('spreads variadic positionals and refuses a missing required one', () => {
    const add = tools.find((t) => t.name === 'fleex_ticket_tag_add')!;
    expect(cliToolArgv(add, { id: '1', tags: ['a', 'b'] }, null)).toEqual(['ticket', 'tag', 'add', '1', 'a', 'b']);
    expect(() => cliToolArgv(add, { tags: ['a'] }, null)).toThrow(/missing required argument: id/);
  });
  it('parseFlags reads the long flag and whether it takes a value', () => {
    expect(parseFlags('-s, --status <status>')).toEqual({ flag: '--status', takesValue: true });
    expect(parseFlags('--full')).toEqual({ flag: '--full', takesValue: false });
    expect(parseFlags('-x')).toBeNull();
  });
});

describe('toKey', () => {
  it('turns CLI names into valid tool property keys', async () => {
    const { toKey } = await import('../../src/application/assistant/fleex-cli-tools.js');
    expect(toKey('id|name')).toBe('idOrName');
    expect(toKey('org/name')).toBe('orgName');
    expect(toKey('--with-comments')).toBe('withComments');
    expect(toKey('<id>')).toBe('id');
    expect(toKey('///')).toBe('value');
    for (const k of [toKey('id|name'), toKey('org/name'), toKey('--a.b')]) expect(k).toMatch(/^[a-zA-Z0-9_.-]{1,64}$/);
  });
  it('dedupes colliding keys inside one tool', () => {
    const tools = buildCliTools([{
      path: 'fleex ticket odd', description: 'x', subcommands: [],
      arguments: [{ name: 'id', description: '', required: true, variadic: false }],
      options: [{ flags: '--id <id>', description: '', required: true, mandatory: false }],
    }]);
    expect(Object.keys(tools[0]!.inputSchema.properties)).toEqual(['id', 'id_2']);
  });
});

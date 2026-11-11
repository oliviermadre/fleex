import { describe, it, expect } from 'vitest';
import { ASSISTANT_CLI_COMMANDS, buildCliTools, cliToolArgv, parseFlags, type CliCommandDoc } from '../../src/application/assistant/fleex-cli-tools.js';

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
  it('exposes only allow-listed leaf commands: no group, no delete, no command nobody listed', () => {
    const names = buildCliTools(docs).map((t) => t.name);
    expect(names).toEqual(['fleex_ticket_show', 'fleex_ticket_update']);
  });
  it('keeps human decisions, thread bypasses and team configuration away from the assistant', () => {
    // The orchestrator relays a gate or a route to the user, never settles it; launching and
    // stopping go through thread tools so their author is traced; personas are the user's.
    const leaf = (path: string): CliCommandDoc => ({ path: `fleex ${path}`, description: path, arguments: [], options: [], subcommands: [] });
    const withheld = [
      'workflow gate resolve', 'workflow route', 'workflow run cancel', 'workflow step retry', 'workflow apply',
      'ticket mention ack', 'ticket mention resolve', 'ticket mention run', 'ticket mention wait',
      'ticket comment-delete', 'ticket archive', 'ticket delete', 'ticket todo delete',
      'agent update', 'skill update', 'panel update', 'board update', 'epic update',
    ];
    expect(buildCliTools(withheld.map(leaf))).toEqual([]);
    for (const path of withheld) expect(ASSISTANT_CLI_COMMANDS).not.toContain(path);
    const kept = ['ticket show', 'ticket update', 'ticket move', 'ticket comment', 'ticket link', 'ticket deliverable add', 'ticket todo done', 'workflow run show'];
    expect(buildCliTools(kept.map(leaf)).map((t) => t.commandPath.join(' '))).toEqual(kept);
  });
  it('does not offer a command the CLI gains later until it is added to the list', () => {
    const fresh: CliCommandDoc = { path: 'fleex ticket teleport', description: 'new', arguments: [], options: [], subcommands: [] };
    expect(buildCliTools([fresh])).toEqual([]);
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
  const tools = buildCliTools(docs, ['ticket show', 'ticket update', 'ticket tag add']);
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
    }], ['ticket odd']);
    expect(Object.keys(tools[0]!.inputSchema.properties)).toEqual(['id', 'id_2']);
  });
});

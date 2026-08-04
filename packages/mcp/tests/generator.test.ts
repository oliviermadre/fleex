import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { generateTools } from '../src/generator.ts';
import { buildArgv } from '../src/argv.ts';
import type { GeneratedTool } from '../src/types.ts';

/** Build a small fleex-like tree mirroring real command shapes. */
function fakeProgram(): Command {
  const root = new Command('fleex').enablePositionalOptions();

  const ticket = root.command('ticket').description('Manage tickets');

  const create = ticket.command('create').description('Create a new ticket');
  create.requiredOption('--title <title>', 'Ticket title (required)');
  create.option('--board <id>', 'Board ID');
  create.option('--description <description>', 'Ticket description');
  create.option('--tag <tag>', 'Tag (repeatable)', (v: string, p: string[] = []) => [...p, v], [] as string[]);
  // Simulate workspaceAware bootstrap behaviour.
  create.option('--workspace <name>', 'Target workspace');

  const list = ticket.command('list').description('List tickets');
  list.option('--status <status>', 'Filter by status');
  list.option('--workspace <name>', 'Target workspace');

  const move = ticket.command('move').description('Change a ticket status');
  move.argument('<id>', 'Ticket display ID or UUID');
  move.argument('<status>', 'Target status');
  move.option('--board <id>', 'Disambiguate by board');

  const update = ticket.command('update').description('Update a ticket');
  update.argument('<id>', 'Ticket ID');
  update.option('--favorite', 'Mark as favorite');
  update.option('--blocked', 'Mark as blocked');
  update.option('--no-blocked', 'Unmark blocked');
  // Declared only in negative form — must still reach the surface.
  update.option('--no-color', 'Clear the badge colour');
  update.option('--to-board <id>', 'Move to another board');

  const del = ticket.command('delete').description('Delete a ticket');
  del.argument('<id>', 'Ticket ID');
  del.option('-f, --force', 'Skip confirmation');

  // A parent group with subcommands — must NOT become a tool itself.
  const deliverable = ticket.command('deliverable').description('Manage deliverables');
  const add = deliverable.command('add').description('Add a deliverable');
  add.argument('<id>', 'Ticket ID');
  add.requiredOption('--title <t>', 'Title');

  // Infra command outside the allowlist — must be excluded.
  root.command('start').description('Start services');

  return root;
}

function byName(tools: GeneratedTool[], name: string): GeneratedTool {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`tool ${name} not found; have: ${tools.map((x) => x.name).join(', ')}`);
  return t;
}

describe('generateTools', () => {
  const tools = generateTools(fakeProgram());

  it('emits one tool per actionable leaf, excluding parents and infra', () => {
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'fleex_ticket_create',
      'fleex_ticket_delete',
      'fleex_ticket_deliverable_add',
      'fleex_ticket_list',
      'fleex_ticket_move',
      'fleex_ticket_update',
    ]);
    // parent group and infra command are absent
    expect(names).not.toContain('fleex_ticket');
    expect(names).not.toContain('fleex_ticket_deliverable');
    expect(names).not.toContain('fleex_start');
  });

  it('marks mutating leaves and leaves reads alone', () => {
    expect(byName(tools, 'fleex_ticket_create').mutating).toBe(true);
    expect(byName(tools, 'fleex_ticket_move').mutating).toBe(true);
    expect(byName(tools, 'fleex_ticket_update').mutating).toBe(true);
    expect(byName(tools, 'fleex_ticket_deliverable_add').mutating).toBe(true);
    expect(byName(tools, 'fleex_ticket_list').mutating).toBe(false);
  });

  it('builds an input schema with required fields and hides --workspace', () => {
    const create = byName(tools, 'fleex_ticket_create');
    expect(create.inputSchema.required).toContain('title');
    expect(create.inputSchema.properties.title).toEqual({
      type: 'string',
      description: 'Ticket title (required)',
    });
    expect(create.inputSchema.properties.board?.type).toBe('string');
    expect(create.inputSchema.properties.tag).toEqual({
      type: 'array',
      items: { type: 'string' },
      description: 'Tag (repeatable)',
    });
    // --workspace is handled specially, never a normal param
    expect(create.inputSchema.properties.workspace).toBeUndefined();
    expect(create.workspaceAware).toBe(true);
  });

  it('exposes positional arguments in order and as required', () => {
    const move = byName(tools, 'fleex_ticket_move');
    expect(move.arguments.map((a) => a.key)).toEqual(['id', 'status']);
    expect(move.inputSchema.required).toEqual(expect.arrayContaining(['id', 'status']));
    expect(move.workspaceAware).toBe(false);
  });

  it('represents boolean options and camelCases hyphenated longs', () => {
    const update = byName(tools, 'fleex_ticket_update');
    expect(update.inputSchema.properties.favorite?.type).toBe('boolean');
    expect(update.inputSchema.properties.toBoard?.type).toBe('string');
    const toBoard = update.options.find((o) => o.key === 'toBoard');
    expect(toBoard?.flag).toBe('--to-board');
  });

  it('pairs a negatable boolean into one tri-state param and says so', () => {
    const update = byName(tools, 'fleex_ticket_update');
    const blocked = update.options.find((o) => o.key === 'blocked');
    expect(blocked?.flag).toBe('--blocked');
    expect(blocked?.negateFlag).toBe('--no-blocked');
    // A model reading only "Mark as blocked" never guesses it may pass false.
    expect(update.inputSchema.properties.blocked?.description).toBe(
      'Mark as blocked (false: unmark blocked)',
    );
    // Negative-only options still get a param, flagged as such.
    const color = update.options.find((o) => o.key === 'color');
    expect(color?.negateOnly).toBe(true);
    expect(update.inputSchema.properties.color?.type).toBe('boolean');
  });

  it('detects the confirmation-skip flag on destructive commands', () => {
    expect(byName(tools, 'fleex_ticket_delete').confirmFlag).toBe('--force');
    expect(byName(tools, 'fleex_ticket_create').confirmFlag).toBeUndefined();
  });

  it('respects a custom include allowlist', () => {
    const onlyEpic = generateTools(fakeProgram(), { include: ['epic'] });
    expect(onlyEpic).toEqual([]);
  });
});

describe('buildArgv', () => {
  const tools = generateTools(fakeProgram());

  it('rebuilds argv for a create with options and workspace injection', () => {
    const create = byName(tools, 'fleex_ticket_create');
    const argv = buildArgv(
      create,
      { title: 'Fix bug', description: 'line1\nline2', tag: ['urgent', 'wip'] },
      { workspace: 'acme' },
    );
    expect(argv).toEqual([
      'ticket', 'create',
      '--title', 'Fix bug',
      '--description', 'line1\nline2',
      '--tag', 'urgent',
      '--tag', 'wip',
      '--workspace', 'acme',
    ]);
  });

  it('places positional arguments in order', () => {
    const move = byName(tools, 'fleex_ticket_move');
    expect(buildArgv(move, { id: '42', status: 'done' })).toEqual([
      'ticket', 'move', '42', 'done',
    ]);
  });

  it('maps a boolean to its positive or negative flag', () => {
    const update = byName(tools, 'fleex_ticket_update');
    expect(buildArgv(update, { id: '7', blocked: true })).toEqual([
      'ticket', 'update', '7', '--blocked',
    ]);
    // The whole point of the negative form: `false` must reach the CLI. Dropping
    // it made the call look empty and the CLI answered "No updates specified".
    expect(buildArgv(update, { id: '7', blocked: false })).toEqual([
      'ticket', 'update', '7', '--no-blocked',
    ]);
  });

  it('refuses to silently swallow an unsettable boolean', () => {
    const update = byName(tools, 'fleex_ticket_update');
    // `--favorite` has no `--no-favorite` here: failing loudly beats pretending.
    expect(() => buildArgv(update, { id: '7', favorite: false })).toThrow(/cannot be unset/);
  });

  it('handles an option declared only in negative form', () => {
    const update = byName(tools, 'fleex_ticket_update');
    expect(buildArgv(update, { id: '7', color: false })).toEqual([
      'ticket', 'update', '7', '--no-color',
    ]);
    expect(() => buildArgv(update, { id: '7', color: true })).toThrow(/only accepts false/);
  });

  it('accepts a lone string for a repeatable option', () => {
    const create = byName(tools, 'fleex_ticket_create');
    expect(buildArgv(create, { title: 'x', tag: 'urgent' })).toEqual([
      'ticket', 'create', '--title', 'x', '--tag', 'urgent',
    ]);
    expect(() => buildArgv(create, { title: 'x', tag: 42 })).toThrow(/expects a string or an array/);
  });

  it('appends --json when requested', () => {
    const list = byName(tools, 'fleex_ticket_list');
    expect(buildArgv(list, { status: 'doing' }, { json: true })).toEqual([
      'ticket', 'list', '--status', 'doing', '--json',
    ]);
  });

  it('injects the confirm flag with assumeYes, without duplicating it', () => {
    const del = byName(tools, 'fleex_ticket_delete');
    expect(buildArgv(del, { id: '5' }, { assumeYes: true })).toEqual(['ticket', 'delete', '5', '--force']);
    // already provided by the model → not duplicated
    expect(buildArgv(del, { id: '5', force: true }, { assumeYes: true })).toEqual(['ticket', 'delete', '5', '--force']);
    // assumeYes off → no force flag
    expect(buildArgv(del, { id: '5' })).toEqual(['ticket', 'delete', '5']);
  });

  it('throws when a required positional argument is missing', () => {
    const move = byName(tools, 'fleex_ticket_move');
    expect(() => buildArgv(move, { id: '42' })).toThrow(/missing required argument: status/);
  });
});

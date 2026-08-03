import { Command } from 'commander';
import { describe, it, expect } from 'vitest';

import { buildArgv } from '../src/argv.ts';
import { generateTools } from '../src/generator.ts';

import type { GeneratedTool } from '../src/types.ts';

/** Build a small fleex-like tree mirroring real command shapes. */
function fakeProgram(): Command {
  const root = new Command('fleex').enablePositionalOptions();

  const ticket = root.command('ticket').description('Manage tickets');

  const create = ticket.command('create').description('Create a new ticket');
  create.requiredOption('--title <title>', 'Ticket title (required)');
  create.option('--board <id>', 'Board ID');
  create.option('--description <description>', 'Ticket description');
  create.option(
    '--tag <tag>',
    'Tag (repeatable)',
    (v: string, p: string[] = []) => [...p, v],
    [] as string[],
  );
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
  update.option('--to-board <id>', 'Move to another board');

  const del = ticket.command('delete').description('Delete a ticket');
  del.argument('<id>', 'Ticket ID');
  del.option('-f, --force', 'Skip confirmation');

  // Same flag NAME, different meaning — mirrors `marketplace add --force`
  // ("re-clone if it already exists"). An operation modifier, not a gate.
  const importCmd = ticket.command('import').description('Import a ticket from GitHub');
  importCmd.argument('<url>', 'GitHub issue URL');
  importCmd.option('--force', 're-import even if the ticket already exists');

  // Long-running: creates a git worktree and runs post-checkout hooks.
  const link = ticket.command('link').description('Link a repo to a ticket');
  link.argument('<id>', 'Ticket ID');
  link.option('--repo <name>', 'Repository');

  // A leaf nobody classified — the fail-closed default must gate it.
  ticket.command('frobnicate').description('Do something new and unclassified');

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
      'fleex_ticket_frobnicate',
      'fleex_ticket_import',
      'fleex_ticket_link',
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

  it('gates a leaf it does not recognise (fail-closed)', () => {
    // Classification is a security control, so the unknown case must land on
    // the safe side: a command added tomorrow is gated until proven read-only.
    expect(byName(tools, 'fleex_ticket_frobnicate').mutating).toBe(true);
  });

  it('gives long-running commands their own execution budget', () => {
    // `ticket link` awaits worktree creation + post-checkout hooks server-side;
    // the ambient 30s default would kill it mid-flight.
    expect(byName(tools, 'fleex_ticket_link').timeoutMs).toBe(300_000);
    expect(byName(tools, 'fleex_ticket_list').timeoutMs).toBeUndefined();
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

  it('detects the confirmation-skip flag on destructive commands', () => {
    expect(byName(tools, 'fleex_ticket_delete').confirmFlag).toBe('--force');
    expect(byName(tools, 'fleex_ticket_create').confirmFlag).toBeUndefined();
  });

  it('keeps the confirmation-skip flag out of the model-facing schema', () => {
    // If `--force` were a tool parameter the model could wave away the CLI's
    // own guard on its own initiative. It is host-controlled, like --workspace.
    const del = byName(tools, 'fleex_ticket_delete');
    expect(del.inputSchema.properties.force).toBeUndefined();
    expect(del.options.map((o) => o.key)).not.toContain('force');
    // …but the executor still knows which flag to inject once approved.
    expect(del.confirmFlag).toBe('--force');
  });

  it('leaves a --force that is an operation modifier alone', () => {
    // `--force` is not always a confirmation gate: on `marketplace add` it means
    // "re-clone if it already exists". Matching on the flag name alone would
    // strip it from the schema AND re-inject it on every approved call — here,
    // silently re-importing a ticket the caller never asked to overwrite. The
    // stated intent in the description is what separates the two.
    const imported = byName(tools, 'fleex_ticket_import');
    expect(imported.confirmFlag).toBeUndefined();
    expect(imported.inputSchema.properties.force?.type).toBe('boolean');
    expect(imported.options.map((o) => o.key)).toContain('force');
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
      'ticket',
      'create',
      '--title',
      'Fix bug',
      '--description',
      'line1\nline2',
      '--tag',
      'urgent',
      '--tag',
      'wip',
      '--workspace',
      'acme',
    ]);
  });

  it('places positional arguments in order', () => {
    const move = byName(tools, 'fleex_ticket_move');
    expect(buildArgv(move, { id: '42', status: 'done' })).toEqual(['ticket', 'move', '42', 'done']);
  });

  it('emits boolean flags only when true', () => {
    const update = byName(tools, 'fleex_ticket_update');
    expect(buildArgv(update, { id: '7', favorite: true })).toEqual([
      'ticket',
      'update',
      '7',
      '--favorite',
    ]);
    expect(buildArgv(update, { id: '7', favorite: false })).toEqual(['ticket', 'update', '7']);
  });

  it('appends --json when requested', () => {
    const list = byName(tools, 'fleex_ticket_list');
    expect(buildArgv(list, { status: 'doing' }, { json: true })).toEqual([
      'ticket',
      'list',
      '--status',
      'doing',
      '--json',
    ]);
  });

  it('injects the confirm flag only when the host says so', () => {
    const del = byName(tools, 'fleex_ticket_delete');
    expect(buildArgv(del, { id: '5' }, { assumeYes: true })).toEqual([
      'ticket',
      'delete',
      '5',
      '--force',
    ]);
    // assumeYes off → no force flag
    expect(buildArgv(del, { id: '5' })).toEqual(['ticket', 'delete', '5']);
  });

  it('ignores a force flag the model supplies itself', () => {
    // The gate only means something if the model cannot open it. `force` is not
    // in the schema, and even if a client smuggles it through it is dropped.
    const del = byName(tools, 'fleex_ticket_delete');
    expect(buildArgv(del, { id: '5', force: true })).toEqual(['ticket', 'delete', '5']);
  });

  it('never injects a --force that was not a confirmation gate', () => {
    // The dangerous half of misreading a modifier as a gate: approval of ANY
    // call would silently add `--force`, so every import would overwrite.
    const imported = byName(tools, 'fleex_ticket_import');
    expect(buildArgv(imported, { url: 'u' }, { assumeYes: true })).toEqual([
      'ticket',
      'import',
      'u',
    ]);
    // It stays a normal parameter the caller can set deliberately.
    expect(buildArgv(imported, { url: 'u', force: true })).toEqual([
      'ticket',
      'import',
      'u',
      '--force',
    ]);
  });

  it('throws when a required positional argument is missing', () => {
    const move = byName(tools, 'fleex_ticket_move');
    expect(() => buildArgv(move, { id: '42' })).toThrow(/missing required argument: status/);
  });
});

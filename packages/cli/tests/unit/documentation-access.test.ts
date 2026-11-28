import { describe, it, expect } from 'vitest';
import { Command } from 'commander';
import { recordCommandAccess } from '../../src/core/access.ts';
import { describeCommand, renderMarkdown, renderText } from '../../src/commands/documentation/index.ts';

// The machine-readable catalogue is how surfaces that do not import the CLI
// (the assistant's badges) learn whether a command writes.
describe('documentation access export', () => {
  it('exposes the declared access of a runnable command', () => {
    const cmd = new Command('delete').description('Delete');
    recordCommandAccess(cmd, 'destructive');
    expect(describeCommand(cmd, ['fleex', 'ticket', 'delete']).access).toBe('destructive');
  });

  it('leaves parent groups without an access', () => {
    const cmd = new Command('ticket');
    cmd.command('list');
    expect(describeCommand(cmd, ['fleex', 'ticket']).access).toBeUndefined();
  });

  it('labels the command in the markdown and text references', () => {
    const root = new Command('fleex');
    const list = root.command('list').description('List');
    recordCommandAccess(list, 'read');
    const docs = [describeCommand(list, ['fleex', 'list'])];
    expect(renderMarkdown(root, docs)).toContain('## `fleex list` [lecture]');
    expect(renderText(root, docs)).toContain('fleex list [lecture]');
  });
});

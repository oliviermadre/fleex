import chalk from 'chalk';
import { Command } from 'commander';
import { describe, it, expect } from 'vitest';

import { describeCommand } from '../../src/commands/documentation/index.ts';
import { stripAnsi } from '../../src/core/colors.ts';
import { recordExtraHelp, getExtraHelp } from '../../src/core/help.ts';

describe('stripAnsi', () => {
  it('removes SGR escape sequences', () => {
    expect(stripAnsi('\x1B[1m\x1B[33mExamples:\x1B[39m\x1B[22m')).toBe('Examples:');
  });
  it('removes chalk-produced sequences', () => {
    expect(stripAnsi(chalk.bold.yellow('Examples:'))).toBe('Examples:');
  });
  it('leaves plain strings untouched', () => {
    expect(stripAnsi('plain text')).toBe('plain text');
  });
});

describe('documentation notes export', () => {
  it('exports recorded extraHelp as ANSI-stripped notes', () => {
    const cmd = new Command('update').description('Update something');
    recordExtraHelp(cmd, `\n\x1B[1m\x1B[33mExamples:\x1B[39m\x1B[22m\n  fleex agent update x\n`);
    const doc = describeCommand(cmd, ['fleex', 'agent', 'update']);
    expect(doc.notes).toBe('Examples:\n  fleex agent update x');
    expect(doc.notes).not.toMatch(/\x1B/);
  });

  it('omits notes when no extraHelp was recorded', () => {
    const cmd = new Command('list').description('List');
    expect(getExtraHelp(cmd)).toBeUndefined();
    expect(describeCommand(cmd, ['fleex', 'list']).notes).toBeUndefined();
  });
});

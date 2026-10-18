/**
 * `fleex memory ask --question "…"` looked like a silent `exit 1`.
 *
 * `question` is a positional argument, but the MCP layer exposes it as a named
 * field, so agents going back to the shell write `--question`. Commander rejected
 * it with one line, then buried that line under the full help: anyone keeping
 * only the tail of stderr saw generic help and an exit code. These tests pin the
 * two things that make the error usable: it hands back the corrected command,
 * and it is short enough to survive truncation.
 *
 * The tree mirrors `buildProgram()` (root settings, `--json` on every leaf)
 * without its filesystem scan, which needs the Bun runtime.
 */
import { describe, it, expect } from 'vitest';
import { CommanderError, type Command } from 'commander';
import { FleexCommand } from '../../src/core/parse-errors.ts';

interface Run { stderr: string; stdout: string; exitCode: number | null; reached: boolean }

function buildTree(onAction: () => void): Command {
  const program = new FleexCommand();
  program.name('fleex').showHelpAfterError().enablePositionalOptions().exitOverride();
  const memory = program.command('memory').description('Memory');
  memory.command('ask').alias('a')
    .argument('<question...>', 'The question')
    .option('-r, --repo <owner/name>', 'Repository')
    .option('-n, --limit <n>', 'Excerpts')
    .option('--json', 'JSON output')
    .action(onAction);
  memory.command('search').alias('s')
    .argument('<query...>', 'What to look for')
    .option('-r, --repo <owner/name>', 'Repository')
    .option('--json', 'JSON output')
    .action(onAction);
  program.command('ticket').command('show')
    .argument('<id>', 'Ticket')
    .option('--json', 'JSON output')
    .action(onAction);
  return program;
}

function run(...args: string[]): Run {
  const out: Run = { stderr: '', stdout: '', exitCode: null, reached: false };
  const program = buildTree(() => { out.reached = true; });
  program.configureOutput({
    writeErr: (s) => { out.stderr += s; },
    writeOut: (s) => { out.stdout += s; },
  });
  try {
    program.parse(args, { from: 'user' });
  } catch (e) {
    if (!(e instanceof CommanderError)) throw e;
    out.exitCode = e.exitCode;
  }
  return out;
}

const lines = (s: string): string[] => s.trimEnd().split('\n');

describe('a positional argument passed as a flag', () => {
  it('names the mistake and hands back the command to run (AC1)', () => {
    const r = run('memory', 'ask', '--question', 'q', '--repo', 'o/r');
    expect(r.stderr).toContain('--question is not an option — <question> is a positional argument.');
    expect(r.stderr).toContain('Try: fleex memory ask "q" --repo o/r');
    expect(r.exitCode).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.reached).toBe(false);
  });

  it('keeps every other argument in the order it was typed', () => {
    const r = run('memory', 'ask', '--repo', 'o/r', '--question', 'q', '--limit', '20');
    expect(r.stderr).toContain('Try: fleex memory ask "q" --repo o/r --limit 20');
  });

  it('gives the same hint for the `--flag=value` form (AC4)', () => {
    expect(run('memory', 'ask', '--question=q', '--repo', 'o/r').stderr)
      .toContain('Try: fleex memory ask "q" --repo o/r');
  });

  it('uses a placeholder when the flag has no value (AC5)', () => {
    expect(run('memory', 'ask', '--repo', 'o/r', '--question').stderr)
      .toContain('Try: fleex memory ask "<question>" --repo o/r');
    // Followed by another flag: that flag is not the value.
    expect(run('memory', 'ask', '--question', '--repo', 'o/r').stderr)
      .toContain('Try: fleex memory ask "<question>" --repo o/r');
  });

  it('matches the argument name regardless of case or separator', () => {
    expect(run('memory', 'ask', '--Question', 'q').stderr).toContain('Try: fleex memory ask "q"');
  });

  it('quotes the value so the suggested command is safe to paste', () => {
    expect(run('memory', 'ask', '--question', 'say "hi" $HOME').stderr)
      .toContain('Try: fleex memory ask "say \\"hi\\" \\$HOME"');
  });

  it('keeps a value that starts with a dash, after `--` so the suggestion still parses', () => {
    // Found in QA: `"<question>" "-1 bug"` was suggested, and replaying it failed
    // with `unknown option '-1 bug'`. A suggestion that fails is worse than none.
    expect(run('memory', 'ask', '--question', '-1 bug', '--repo', 'o/r').stderr)
      .toContain('Try: fleex memory ask --repo o/r -- "-1 bug"');
    expect(run('memory', 'ask', '--question=-1', '--repo', 'o/r').stderr)
      .toContain('Try: fleex memory ask --repo o/r -- "-1"');
    // A long flag is still never taken as the value.
    expect(run('memory', 'ask', '--question', '--foo').stderr).toContain('Try: fleex memory ask "<question>" --foo');
    const replay = run('memory', 'ask', '--repo', 'o/r', '--', '-1 bug');
    expect(replay.reached).toBe(true);
  });

  it('suggests the canonical command name when an alias was typed', () => {
    expect(run('memory', 'a', '--question', 'q').stderr).toContain('Try: fleex memory ask "q"');
  });

  it('works outside `memory` (AC10)', () => {
    expect(run('ticket', 'show', '--id', 'X').stderr).toContain('Try: fleex ticket show "X"');
  });
});

describe('any parsing error stays short enough to survive truncation', () => {
  it('reports a genuinely unknown option without inventing a fix (AC6)', () => {
    const r = run('memory', 'ask', 'q', '--foo');
    expect(r.stderr).toContain("error: unknown option '--foo'");
    expect(r.stderr).not.toContain('Try:');
    expect(r.stderr).toContain('Usage: fleex memory ask|a [options] <question...>');
    expect(r.stderr).toContain('Run `fleex memory ask --help` for all options.');
  });

  it('reports a missing argument in at most five lines (AC7)', () => {
    const r = run('memory', 'search', '--repo', 'o/r');
    expect(lines(r.stderr)).toEqual([
      "error: missing required argument 'query'",
      '',
      'Usage: fleex memory search|s [options] <query...>',
      'Run `fleex memory search --help` for all options.',
    ]);
    expect(r.exitCode).toBe(1);
  });

  it('no longer appends the full help (AC8)', () => {
    for (const args of [['memory', 'ask', '--question', 'q'], ['memory', 'search'], ['memory', 'ask', 'q', '--foo']]) {
      const r = run(...args);
      expect(r.stderr).not.toContain('Options:');
      expect(lines(r.stderr).length).toBeLessThanOrEqual(5);
    }
  });

  it('keeps stdout empty under --json (AC9)', () => {
    const plain = run('memory', 'ask', '--question', 'q');
    const json = run('memory', 'ask', '--question', 'q', '--json');
    expect(json.stdout).toBe('');
    expect(json.exitCode).toBe(1);
    expect(json.stderr).toContain('Try: fleex memory ask "q" --json');
    expect(lines(json.stderr).length).toBe(lines(plain.stderr).length);
  });
});

describe('what must not change', () => {
  it('still runs the command when the syntax is right (AC11)', () => {
    const r = run('memory', 'ask', 'q', '--repo', 'o/r');
    expect(r.reached).toBe(true);
    expect(r.stderr).toBe('');
  });

  it('keeps the full help on a group error, where it lists the subcommands', () => {
    const r = run('memory', 'ask-me');
    expect(r.stderr).toContain("error: unknown command 'ask-me'");
    expect(r.stderr).toContain('Commands:');
  });
});

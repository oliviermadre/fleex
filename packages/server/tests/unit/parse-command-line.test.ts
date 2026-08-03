import { describe, it, expect } from 'vitest';
import { parseCommandLine, extractPlaceholders } from '@fleex/shared';

/**
 * `needsShell` decides whether a migrated action keeps shell semantics or is
 * downgraded to `execFile`. Getting it wrong in either direction is a bug that
 * users feel: a false negative silently changes what their command does, a
 * false positive keeps them on the shell path unnecessarily.
 */
describe('parseCommandLine', () => {
  describe('tokenisation', () => {
    it('splits on whitespace runs', () => {
      expect(parseCommandLine('code   /tmp/foo')).toEqual({
        command: 'code',
        args: ['/tmp/foo'],
        needsShell: false,
      });
    });

    it('keeps a double-quoted run as one argument', () => {
      expect(parseCommandLine('open -a "Visual Studio Code" /tmp')).toEqual({
        command: 'open',
        args: ['-a', 'Visual Studio Code', '/tmp'],
        needsShell: false,
      });
    });

    it('keeps a single-quoted run as one argument', () => {
      const { args } = parseCommandLine("git commit -m 'hello world'");
      expect(args).toEqual(['commit', '-m', 'hello world']);
    });

    it('honours backslash escapes outside quotes', () => {
      const { args } = parseCommandLine('code /tmp/my\\ folder');
      expect(args).toEqual(['/tmp/my folder']);
    });

    it('concatenates adjacent quoted and bare runs into one word', () => {
      const { args } = parseCommandLine('code "/tmp"/sub');
      expect(args).toEqual(['/tmp/sub']);
    });

    it('preserves an empty quoted argument', () => {
      const { args } = parseCommandLine('cmd "" x');
      expect(args).toEqual(['', 'x']);
    });

    it('returns an empty command for an empty string', () => {
      expect(parseCommandLine('')).toEqual({ command: '', args: [], needsShell: false });
    });
  });

  describe('shell detection', () => {
    it.each([
      ['pipe', 'git status | head -20'],
      ['redirection', 'echo hi > /tmp/out'],
      ['and-list', 'cd /tmp && ls'],
      ['semicolon', 'echo a; echo b'],
      ['glob', 'rm /tmp/*.log'],
      ['tilde', 'code ~/projects'],
      ['subshell', 'echo $(date)'],
      ['variable', 'echo $HOME'],
      ['backtick', 'echo `date`'],
      ['newline', 'echo a\necho b'],
    ])('flags %s as needing a shell', (_label, input) => {
      expect(parseCommandLine(input).needsShell).toBe(true);
    });

    it('does not flag a metacharacter neutralised by single quotes', () => {
      // `'a|b'` is a literal filename, not a pipeline — execFile handles it fine.
      expect(parseCommandLine("cat 'a|b'").needsShell).toBe(false);
      expect(parseCommandLine("echo 'a; b'").needsShell).toBe(false);
      expect(parseCommandLine("echo '$HOME'").needsShell).toBe(false);
    });

    it('does not flag a glob or list operator neutralised by double quotes', () => {
      expect(parseCommandLine('cat "a|b"').needsShell).toBe(false);
      expect(parseCommandLine('cat "a*b"').needsShell).toBe(false);
    });

    it('still flags expansion inside double quotes', () => {
      // Double quotes suppress splitting and globbing but NOT substitution:
      // "$HOME" expands, so downgrading to execFile would change the result.
      expect(parseCommandLine('code "$HOME/dev"').needsShell).toBe(true);
      expect(parseCommandLine('echo "`date`"').needsShell).toBe(true);
    });

    it('does not treat a template placeholder as a shell brace', () => {
      expect(parseCommandLine('code {{workspace_path}}')).toEqual({
        command: 'code',
        args: ['{{workspace_path}}'],
        needsShell: false,
      });
    });

    it('keeps a placeholder verbatim inside a quoted argument', () => {
      expect(parseCommandLine('open -a "PhpStorm" "{{workspace_path}}"')).toEqual({
        command: 'open',
        args: ['-a', 'PhpStorm', '{{workspace_path}}'],
        needsShell: false,
      });
    });

    it('flags a lone brace that is not a placeholder', () => {
      expect(parseCommandLine('echo {a,b}').needsShell).toBe(true);
    });
  });
});

describe('extractPlaceholders', () => {
  it('rewrites an unquoted placeholder as a quoted positional', () => {
    expect(extractPlaceholders('cd {{workspace_path}} && git status')).toEqual({
      script: 'cd "$1" && git status',
      positional: ['{{workspace_path}}'],
    });
  });

  it('numbers placeholders in order of appearance', () => {
    const { script, positional } = extractPlaceholders('a {{one}} b {{two}}');
    expect(script).toBe('a "$1" b "$2"');
    expect(positional).toEqual(['{{one}}', '{{two}}']);
  });

  it('gives repeated expressions their own positional slot', () => {
    const { script, positional } = extractPlaceholders('{{x}} {{x}}');
    expect(script).toBe('"$1" "$2"');
    expect(positional).toEqual(['{{x}}', '{{x}}']);
  });

  it('does not re-quote a placeholder already inside double quotes', () => {
    // Emitting `"$1"` here would close the run and re-expose the value to
    // word splitting on the following segment.
    expect(extractPlaceholders('echo "path: {{workspace_path}}!"')).toEqual({
      script: 'echo "path: $1!"',
      positional: ['{{workspace_path}}'],
    });
  });

  it('breaks out of a single-quoted run so the positional expands', () => {
    // Inside '…' a `$1` is literal, so the run must be closed and re-opened.
    expect(extractPlaceholders("echo 'x {{y}} z'")).toEqual({
      script: `echo 'x '"$1"' z'`,
      positional: ['{{y}}'],
    });
  });

  it('leaves a script without placeholders untouched', () => {
    expect(extractPlaceholders('git status | head -20')).toEqual({
      script: 'git status | head -20',
      positional: [],
    });
  });

  it('preserves the pipe expression so context resolution still applies', () => {
    const { positional } = extractPlaceholders('echo {{ticket_slug | upper}}');
    expect(positional).toEqual(['{{ticket_slug | upper}}']);
  });
});

import { describe, it, expect } from 'vitest';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn, ExecResult } from '../host/types.js';
import { GitCliAdapter } from './git-cli.adapter.js';

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
} as unknown as LoggerPort;

interface Call {
  command: string;
  args: string[];
  cwd?: string;
}

/** Fake exec that records calls and answers by matching the joined args. */
function makeExec(responses: { match: (args: string[]) => boolean; result: Partial<ExecResult> | Error }[]) {
  const calls: Call[] = [];
  const fn: ExecFn = async (command, args, options) => {
    calls.push({ command, args, cwd: options?.cwd });
    const hit = responses.find((r) => r.match(args));
    if (!hit) return { stdout: '', stderr: '' };
    if (hit.result instanceof Error) throw hit.result;
    return { stdout: '', stderr: '', ...hit.result };
  };
  return { fn, calls };
}

describe('GitCliAdapter.getDiffPatch', () => {
  it('diffs the working tree against the merge-base of the given base and HEAD', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'merge-base', result: { stdout: 'MERGEBASE_SHA\n' } },
      { match: (a) => a[0] === 'diff', result: { stdout: 'PATCH_TEXT' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const patch = await git.getDiffPatch('/wt', 'origin/main');

    expect(patch).toBe('PATCH_TEXT');
    const mb = calls.find((c) => c.args[0] === 'merge-base')!;
    expect(mb.args).toEqual(['merge-base', 'origin/main', 'HEAD']);
    expect(mb.cwd).toBe('/wt');
    const diff = calls.find((c) => c.args[0] === 'diff')!;
    expect(diff.args).toEqual(['diff', '--no-color', 'MERGEBASE_SHA']);
    expect(diff.cwd).toBe('/wt');
  });

  it('resolves origin/<default-branch> when no base is passed', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'symbolic-ref', result: { stdout: 'refs/remotes/origin/develop\n' } },
      { match: (a) => a[0] === 'merge-base', result: { stdout: 'MB\n' } },
      { match: (a) => a[0] === 'diff', result: { stdout: 'P' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    await git.getDiffPatch('/wt');

    const mb = calls.find((c) => c.args[0] === 'merge-base')!;
    expect(mb.args).toEqual(['merge-base', 'origin/develop', 'HEAD']);
  });

  it('falls back to a two-dot diff against base when merge-base fails', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'merge-base', result: new Error('no merge base') },
      { match: (a) => a[0] === 'diff', result: { stdout: 'FALLBACK' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const patch = await git.getDiffPatch('/wt', 'origin/main');

    expect(patch).toBe('FALLBACK');
    const diff = calls.find((c) => c.args[0] === 'diff')!;
    expect(diff.args).toEqual(['diff', '--no-color', 'origin/main']);
  });
});

describe('GitCliAdapter.getChangedFiles', () => {
  it('lists file names changed vs the merge-base of base and HEAD', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'merge-base', result: { stdout: 'MB\n' } },
      { match: (a) => a[0] === 'diff', result: { stdout: 'a.ts\nsrc/b.ts\n' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const files = await git.getChangedFiles('/wt', 'origin/main');

    expect(files).toEqual(['a.ts', 'src/b.ts']);
    const diff = calls.find((c) => c.args[0] === 'diff')!;
    expect(diff.args).toEqual(['diff', '--name-only', 'MB']);
    expect(diff.cwd).toBe('/wt');
  });

  it('falls back to a two-dot name diff when merge-base fails', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'merge-base', result: new Error('no merge base') },
      { match: (a) => a[0] === 'diff', result: { stdout: 'x.ts\n' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const files = await git.getChangedFiles('/wt', 'origin/main');

    expect(files).toEqual(['x.ts']);
    const diff = calls.find((c) => c.args[0] === 'diff')!;
    expect(diff.args).toEqual(['diff', '--name-only', 'origin/main']);
  });
});

describe('GitCliAdapter.getFileDiffPatch', () => {
  it('diffs a single file against the merge-base', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'merge-base', result: { stdout: 'MB\n' } },
      { match: (a) => a[0] === 'diff', result: { stdout: 'PATCH' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const patch = await git.getFileDiffPatch('/wt', 'src/app.ts', 'origin/main');

    expect(patch).toBe('PATCH');
    const diff = calls.find((c) => c.args[0] === 'diff')!;
    expect(diff.args).toEqual(['diff', '--no-color', 'MB', '--', 'src/app.ts']);
    expect(diff.cwd).toBe('/wt');
  });
});

describe('GitCliAdapter.getFileBaseContent', () => {
  it('shows the file at the merge-base', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'merge-base', result: { stdout: 'MB\n' } },
      { match: (a) => a[0] === 'show', result: { stdout: 'BASE CONTENT' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const content = await git.getFileBaseContent('/wt', 'src/app.ts', 'origin/main');

    expect(content).toBe('BASE CONTENT');
    const show = calls.find((c) => c.args[0] === 'show')!;
    expect(show.args).toEqual(['show', 'MB:src/app.ts']);
    expect(show.cwd).toBe('/wt');
  });

  it('returns empty string when the file does not exist at base (new file)', async () => {
    const { fn } = makeExec([
      { match: (a) => a[0] === 'merge-base', result: { stdout: 'MB\n' } },
      { match: (a) => a[0] === 'show', result: new Error('path does not exist') },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    expect(await git.getFileBaseContent('/wt', 'new.ts', 'origin/main')).toBe('');
  });
});

describe('GitCliAdapter.listTrackedFiles', () => {
  it('lists HEAD paths recursively', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'ls-tree', result: { stdout: 'a.ts\nsrc/b.ts\n' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const out = await git.listTrackedFiles('/wt');

    expect(out).toBe('a.ts\nsrc/b.ts\n');
    expect(calls[0]!.args).toEqual(['ls-tree', '-r', '--name-only', 'HEAD']);
    expect(calls[0]!.cwd).toBe('/wt');
  });
});

describe('GitCliAdapter.getStatusPorcelain', () => {
  it('runs git status --porcelain in the worktree', async () => {
    const { fn, calls } = makeExec([
      { match: (a) => a[0] === 'status', result: { stdout: ' M a.ts\n' } },
    ]);
    const git = new GitCliAdapter(fn, noopLogger);

    const out = await git.getStatusPorcelain('/wt');

    expect(out).toBe(' M a.ts\n');
    expect(calls[0]!.args).toEqual(['status', '--porcelain']);
    expect(calls[0]!.cwd).toBe('/wt');
  });
});

import { describe, it, expect } from 'vitest';
import { parseUnifiedDiff, changedLineNumbers } from './diff-parser.js';

describe('parseUnifiedDiff', () => {
  it('returns no files for an empty patch', () => {
    expect(parseUnifiedDiff('')).toEqual([]);
    expect(parseUnifiedDiff('   \n')).toEqual([]);
  });

  it('parses a single-file modification with one hunk', () => {
    const patch = [
      'diff --git a/src/app.ts b/src/app.ts',
      'index 1111111..2222222 100644',
      '--- a/src/app.ts',
      '+++ b/src/app.ts',
      '@@ -1,3 +1,4 @@ export function app() {',
      ' const a = 1;',
      '-const b = 2;',
      '+const b = 3;',
      '+const c = 4;',
      ' return a;',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files).toHaveLength(1);
    const f = files[0]!;
    expect(f.path).toBe('src/app.ts');
    expect(f.additions).toBe(2);
    expect(f.deletions).toBe(1);
    expect(f.hunks).toHaveLength(1);
    expect(f.hunks[0]!.header).toBe('@@ -1,3 +1,4 @@ export function app() {');
    expect(f.hunks[0]!.lines).toEqual([
      { kind: 'ctx', text: 'const a = 1;' },
      { kind: 'del', text: 'const b = 2;' },
      { kind: 'add', text: 'const b = 3;' },
      { kind: 'add', text: 'const c = 4;' },
      { kind: 'ctx', text: 'return a;' },
    ]);
  });

  it('parses multiple files each with their own counts', () => {
    const patch = [
      'diff --git a/one.ts b/one.ts',
      '--- a/one.ts',
      '+++ b/one.ts',
      '@@ -1 +1 @@',
      '-old',
      '+new',
      'diff --git a/two.ts b/two.ts',
      '--- a/two.ts',
      '+++ b/two.ts',
      '@@ -0,0 +1,2 @@',
      '+line1',
      '+line2',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files.map((f) => f.path)).toEqual(['one.ts', 'two.ts']);
    expect(files[0]).toMatchObject({ additions: 1, deletions: 1 });
    expect(files[1]).toMatchObject({ additions: 2, deletions: 0 });
  });

  it('uses the b/ path for added files (--- /dev/null)', () => {
    const patch = [
      'diff --git a/new.ts b/new.ts',
      'new file mode 100644',
      'index 0000000..abc1234',
      '--- /dev/null',
      '+++ b/new.ts',
      '@@ -0,0 +1 @@',
      '+hello',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files[0]!.path).toBe('new.ts');
    expect(files[0]!.additions).toBe(1);
  });

  it('uses the a/ path for deleted files (+++ /dev/null)', () => {
    const patch = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      'index abc1234..0000000',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files[0]!.path).toBe('gone.ts');
    expect(files[0]!.deletions).toBe(1);
  });

  it('marks binary files with no hunks and zero counts', () => {
    const patch = [
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'logo.png', binary: true, additions: 0, deletions: 0 });
    expect(files[0]!.hunks).toEqual([]);
  });

  it('ignores the "\\ No newline at end of file" marker', () => {
    const patch = [
      'diff --git a/f.txt b/f.txt',
      '--- a/f.txt',
      '+++ b/f.txt',
      '@@ -1 +1 @@',
      '-a',
      '\\ No newline at end of file',
      '+b',
      '\\ No newline at end of file',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files[0]!.additions).toBe(1);
    expect(files[0]!.deletions).toBe(1);
    expect(files[0]!.hunks[0]!.lines).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
  });

  it('handles paths with spaces (quoted b/ path)', () => {
    const patch = [
      'diff --git a/my file.ts b/my file.ts',
      '--- a/my file.ts',
      '+++ b/my file.ts',
      '@@ -1 +1 @@',
      '-x',
      '+y',
    ].join('\n');

    const files = parseUnifiedDiff(patch);
    expect(files[0]!.path).toBe('my file.ts');
  });
});

describe('changedLineNumbers', () => {
  it('returns [] for an empty patch', () => {
    expect(changedLineNumbers('')).toEqual([]);
  });

  it('records the new-side line numbers of added lines', () => {
    const patch = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1,3 +1,4 @@',
      ' const a = 1;', // new line 1 (ctx)
      '-const b = 2;', // del — no new line
      '+const b = 3;', // new line 2 (add)
      '+const c = 4;', // new line 3 (add)
      ' return a;', // new line 4 (ctx)
    ].join('\n');

    expect(changedLineNumbers(patch)).toEqual([2, 3]);
  });

  it('honours the hunk header new-start offset across multiple hunks', () => {
    const patch = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b', // new line 2
      '@@ -10,2 +11,3 @@',
      ' j',
      '+k', // new line 12
      ' l',
    ].join('\n');

    expect(changedLineNumbers(patch)).toEqual([2, 12]);
  });

  it('ignores the no-newline marker and deletions', () => {
    const patch = [
      'diff --git a/f.ts b/f.ts',
      '--- a/f.ts',
      '+++ b/f.ts',
      '@@ -1,2 +1,1 @@',
      '-gone',
      '+kept', // new line 1
      '\\ No newline at end of file',
    ].join('\n');

    expect(changedLineNumbers(patch)).toEqual([1]);
  });
});

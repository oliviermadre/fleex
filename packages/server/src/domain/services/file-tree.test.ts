import { describe, it, expect } from 'vitest';
import { parseStatusPorcelain, buildFileTree } from './file-tree.js';

describe('parseStatusPorcelain', () => {
  it('returns empty for empty output', () => {
    expect(parseStatusPorcelain('')).toEqual({ changed: [], untracked: [] });
  });

  it('classifies modified, staged and untracked entries', () => {
    const out = [
      ' M src/app.ts',
      'A  src/new.ts',
      '?? scratch.txt',
      ' D removed.ts',
    ].join('\n');
    const { changed, untracked } = parseStatusPorcelain(out);
    expect(changed.sort()).toEqual(['removed.ts', 'src/app.ts', 'src/new.ts']);
    expect(untracked).toEqual(['scratch.txt']);
  });

  it('takes the destination path for renames', () => {
    const out = 'R  old/name.ts -> new/name.ts';
    const { changed } = parseStatusPorcelain(out);
    expect(changed).toEqual(['new/name.ts']);
  });
});

describe('buildFileTree', () => {
  it('nests files under directories, dirs first then alphabetical', () => {
    const nodes = buildFileTree(['src/b.ts', 'src/a.ts', 'readme.md'], [], [], 5);
    expect(nodes.map((n) => n.name)).toEqual(['src', 'readme.md']);
    const src = nodes[0]!;
    expect(src.kind).toBe('dir');
    expect(src.path).toBe('src');
    expect(src.children!.map((c) => c.name)).toEqual(['a.ts', 'b.ts']);
    expect(src.children!.every((c) => c.kind === 'file')).toBe(true);
  });

  it('marks changed files and propagates changed up to ancestor dirs', () => {
    const nodes = buildFileTree(['src/deep/x.ts', 'src/y.ts'], ['src/deep/x.ts'], [], 5);
    const src = nodes[0]!;
    expect(src.changed).toBe(true); // ancestor of a changed file
    const deep = src.children!.find((c) => c.name === 'deep')!;
    expect(deep.changed).toBe(true);
    expect(deep.children![0]!.changed).toBe(true); // x.ts
    const y = src.children!.find((c) => c.name === 'y.ts')!;
    expect(y.changed).toBeUndefined(); // unchanged file has no flag
  });

  it('includes untracked files and marks them changed', () => {
    const nodes = buildFileTree(['a.ts'], [], ['scratch.txt'], 5);
    const scratch = nodes.find((n) => n.name === 'scratch.txt')!;
    expect(scratch.kind).toBe('file');
    expect(scratch.changed).toBe(true);
  });

  it('prunes below the requested depth but keeps ancestor changed flags', () => {
    // depth 2: top-level (1) + one nested level (2); deeper is dropped.
    const nodes = buildFileTree(['a/b/c/deep.ts'], ['a/b/c/deep.ts'], [], 2);
    const a = nodes[0]!;
    expect(a.name).toBe('a');
    expect(a.changed).toBe(true);
    const b = a.children![0]!;
    expect(b.name).toBe('b');
    expect(b.kind).toBe('dir');
    expect(b.changed).toBe(true);
    // depth 2 reached — b's children are pruned even though c/deep.ts exists.
    expect(b.children).toBeUndefined();
  });

  it('de-duplicates a path present in both tracked and untracked lists', () => {
    const nodes = buildFileTree(['a.ts'], [], ['a.ts'], 5);
    expect(nodes.filter((n) => n.name === 'a.ts')).toHaveLength(1);
  });
});

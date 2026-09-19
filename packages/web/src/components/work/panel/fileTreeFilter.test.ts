import { describe, it, expect } from 'vitest';
import type { FileTreeNode } from '@fleex/shared';
import { filterFileTree } from './fileTreeFilter';

const file = (path: string, changed?: boolean): FileTreeNode => ({
  name: path.split('/').pop()!,
  path,
  kind: 'file',
  ...(changed ? { changed } : {}),
});
const dir = (path: string, children: FileTreeNode[]): FileTreeNode => ({
  name: path.split('/').pop()!,
  path,
  kind: 'dir',
  children,
});

const tree: FileTreeNode[] = [
  dir('src', [
    dir('src/components', [file('src/components/FileTree.tsx'), file('src/components/Button.tsx')]),
    file('src/main.ts', true),
  ]),
  dir('tree', [file('tree/index.ts')]),
  file('README.md'),
];

describe('filterFileTree', () => {
  it('returns the tree untouched for a blank query', () => {
    expect(filterFileTree(tree, '')).toBe(tree);
    expect(filterFileTree(tree, '   ')).toBe(tree);
  });

  it('matches a substring of the file name, ignoring case', () => {
    expect(filterFileTree(tree, 'readme')).toEqual([file('README.md')]);
    expect(filterFileTree(tree, 'ETREE')).toEqual([
      dir('src', [dir('src/components', [file('src/components/FileTree.tsx')])]),
    ]);
  });

  it('keeps the ancestors of a deep match and drops unmatched siblings', () => {
    expect(filterFileTree(tree, 'button')).toEqual([
      dir('src', [dir('src/components', [file('src/components/Button.tsx')])]),
    ]);
  });

  it('keeps node flags such as changed', () => {
    expect(filterFileTree(tree, 'main')).toEqual([dir('src', [file('src/main.ts', true)])]);
  });

  it('does not treat a directory name match as a hit', () => {
    expect(filterFileTree(tree, 'components')).toEqual([]);
    // "tree" matches the `tree` dir by name, but only FileTree.tsx is a file hit.
    expect(filterFileTree(tree, 'tree')).toEqual([
      dir('src', [dir('src/components', [file('src/components/FileTree.tsx')])]),
    ]);
  });

  it('trims the query', () => {
    expect(filterFileTree(tree, '  readme  ')).toEqual([file('README.md')]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterFileTree(tree, 'nope')).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';

import type { OverlaySyncFileNode, OverlaySyncDirNode } from '@fleex/shared';

import {
  isDenylistedDir,
  isSafeRelPath,
  parseIgnoredEntries,
  classifyStatus,
  buildTree,
} from '../../src/application/services/overlay-sync-helpers.js';

function file(relPath: string, extra: Partial<OverlaySyncFileNode> = {}): OverlaySyncFileNode {
  const name = relPath.split('/').pop()!;
  return {
    type: 'file',
    name,
    relPath,
    status: 'new',
    size: 0,
    localMtimeMs: null,
    overlayMtimeMs: null,
    ...extra,
  };
}

describe('isDenylistedDir', () => {
  it('flags heavy dirs anywhere in the path', () => {
    expect(isDenylistedDir('node_modules')).toBe(true);
    expect(isDenylistedDir('packages/web/node_modules')).toBe(true);
    expect(isDenylistedDir('server/dist')).toBe(true);
    expect(isDenylistedDir('.next')).toBe(true);
  });

  it('does not flag ordinary config dirs', () => {
    expect(isDenylistedDir('config')).toBe(false);
    expect(isDenylistedDir('certs/local')).toBe(false);
    expect(isDenylistedDir('.env')).toBe(false);
  });
});

describe('isSafeRelPath', () => {
  it('accepts normal relative paths', () => {
    expect(isSafeRelPath('.env')).toBe(true);
    expect(isSafeRelPath('config/local/.env')).toBe(true);
  });

  it('rejects traversal, absolute and empty paths (path-traversal guard)', () => {
    // This is the security invariant: a crafted relPath must never let a
    // copy/remove escape the worktree or overlay root.
    expect(isSafeRelPath('../secret')).toBe(false);
    expect(isSafeRelPath('config/../../etc/passwd')).toBe(false);
    expect(isSafeRelPath('/etc/passwd')).toBe(false);
    expect(isSafeRelPath('')).toBe(false);
    expect(isSafeRelPath('./x')).toBe(false);
    expect(isSafeRelPath('a//b')).toBe(false);
    expect(isSafeRelPath('a\0b')).toBe(false);
  });
});

describe('parseIgnoredEntries', () => {
  it('keeps only ignored entries and splits files vs collapsed dirs', () => {
    // Mixed porcelain -z output: ignored file, ignored dir, untracked, modified.
    const out = ['!! .env', '!! node_modules/', '?? new.ts', ' M edited.ts'].join('\0') + '\0';
    const { files, dirs } = parseIgnoredEntries(out);
    expect(files).toEqual(['.env']);
    expect(dirs).toEqual(['node_modules']);
  });

  it('handles paths with spaces and returns empty for no ignored entries', () => {
    const out = '!! config/my env.local\0';
    expect(parseIgnoredEntries(out).files).toEqual(['config/my env.local']);
    expect(parseIgnoredEntries('').files).toEqual([]);
    expect(parseIgnoredEntries('?? only-untracked\0').files).toEqual([]);
  });
});

describe('classifyStatus', () => {
  it('encodes the overwrite semantics that drive the default check state', () => {
    // WHY: 'new' and 'modified' are checked by default (they change the overlay);
    // 'identical' is a no-op and hidden by default. Misclassifying would either
    // silently skip a needed copy or propose a pointless overwrite.
    expect(classifyStatus('DB=1', null)).toBe('new');
    expect(classifyStatus('DB=1', 'DB=1')).toBe('identical');
    expect(classifyStatus('DB=2', 'DB=1')).toBe('modified');
  });
});

describe('buildTree', () => {
  it('nests files under generated directories and sorts dirs-first', () => {
    const tree = buildTree([
      file('config/.env', { status: 'modified' }),
      file('.env.local'),
      file('config/db.json'),
    ]);
    // Root: dir "config" before file ".env.local"
    expect(tree.map((n) => n.name)).toEqual(['config', '.env.local']);
    const config = tree[0] as OverlaySyncDirNode;
    expect(config.type).toBe('dir');
    expect(config.children.map((n) => n.name)).toEqual(['.env', 'db.json']);
    const env = config.children.find((n) => n.name === '.env') as OverlaySyncFileNode;
    expect(env.relPath).toBe('config/.env');
    expect(env.status).toBe('modified');
  });

  it('inserts collapsed directory markers with their flags', () => {
    const tree = buildTree(
      [file('.env')],
      [
        { relPath: 'node_modules', denylisted: true },
        { relPath: 'logs', truncated: true },
      ],
    );
    const denylisted = tree.find((n) => n.name === 'node_modules') as OverlaySyncDirNode;
    expect(denylisted.type).toBe('dir');
    expect(denylisted.denylisted).toBe(true);
    expect(denylisted.children).toEqual([]);
    const truncated = tree.find((n) => n.name === 'logs') as OverlaySyncDirNode;
    expect(truncated.truncated).toBe(true);
  });
});

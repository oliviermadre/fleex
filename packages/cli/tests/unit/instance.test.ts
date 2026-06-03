import { describe, it, expect } from 'vitest';
import { slugify, instanceSlug } from '../../src/core/instance.ts';

describe('slugify', () => {
  it('keeps safe filesystem characters', () => {
    expect(slugify('feature_branch-1.2')).toBe('feature_branch-1.2');
  });

  it('replaces unsafe characters with dashes', () => {
    expect(slugify('feature/foo bar')).toBe('feature-foo-bar');
  });
});

describe('instanceSlug', () => {
  it('falls back to the slugified branch in legacy mode (no workspace)', () => {
    expect(instanceSlug(null, 'main')).toBe('main');
    expect(instanceSlug(null, 'feature/x')).toBe('feature-x');
  });

  it('uses "default" when the branch is empty', () => {
    expect(instanceSlug(null, '')).toBe('default');
  });

  it('combines workspace and branch as workspace@branch when a workspace is active', () => {
    expect(instanceSlug('tada', 'main')).toBe('tada@main');
    expect(instanceSlug('tada', 'worktree-x')).toBe('tada@worktree-x');
  });

  it('slugifies both the workspace and the branch', () => {
    expect(instanceSlug('my ws', 'feature/y')).toBe('my-ws@feature-y');
  });

  it('keeps two worktrees on the same workspace but different branches distinct', () => {
    expect(instanceSlug('tada', 'main')).not.toBe(instanceSlug('tada', 'wt'));
  });
});

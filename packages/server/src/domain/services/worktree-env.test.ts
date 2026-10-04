import { describe, expect, it } from 'vitest';
import { buildFleexEnv, envArgv, withEnv } from './worktree-env.js';

describe('FLEEX_* environment', () => {
  it('only sets what is known', () => {
    expect(buildFleexEnv({ worktreePath: '/w/fleex', branch: 'main', repo: 'o/fleex' })).toEqual({
      FLEEX_WORKTREE_PATH: '/w/fleex', FLEEX_BRANCH: 'main', FLEEX_REPO: 'o/fleex',
    });
  });

  it('quotes values so a branch or path can never inject shell', () => {
    // WHY: branch names come from users; `$(…)` in one must stay a literal string.
    const cmd = withEnv('make up', { FLEEX_BRANCH: "x'; rm -rf / #$(id)", 'BAD NAME': 'v' });
    expect(cmd).toBe(`export FLEEX_BRANCH='x'\\''; rm -rf / #$(id)'; make up`);
    expect(withEnv('make up', {})).toBe('make up');
  });

  it('builds an env argv for execFile-style calls', () => {
    expect(envArgv({ A: '1' }, ['bash', 'x.sh'])).toEqual(['A=1', 'bash', 'x.sh']);
  });
});

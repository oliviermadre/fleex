import { describe, it, expect } from 'vitest';
import { expandSqlitePath, isPerInstanceSqlitePath } from '../../src/core/sqlite-path.ts';

const HOME = '/Users/o';

describe('expandSqlitePath', () => {
  it('gives each instance its own file, so branch and main never share one SQLite DB', () => {
    const raw = '~/.fleex/qa/{instance}.db';
    const branch = expandSqlitePath(raw, 'qa@agent-697-x', HOME);
    const base = expandSqlitePath(raw, 'qa@qa-697-base', HOME);
    expect(branch).toBe('/Users/o/.fleex/qa/qa@agent-697-x.db');
    expect(base).toBe('/Users/o/.fleex/qa/qa@qa-697-base.db');
    expect(branch).not.toBe(base);
  });

  it('expands ~ because the server opens the path verbatim (a literal ~ dir would be created)', () => {
    expect(expandSqlitePath('~/data/fleex.db', 'default@main', HOME)).toBe('/Users/o/data/fleex.db');
    expect(expandSqlitePath('~', 'x', HOME)).toBe('/Users/o');
  });

  it('leaves a fixed absolute path untouched (existing workspaces keep their data)', () => {
    expect(expandSqlitePath('/Users/o/.fleex/fleex.db', 'sqlite@main', HOME)).toBe('/Users/o/.fleex/fleex.db');
  });

  it('does not treat ~user or a mid-path ~ as the home directory', () => {
    expect(expandSqlitePath('~bob/x.db', 'i', HOME)).toBe('~bob/x.db');
    expect(expandSqlitePath('/a/~/x.db', 'i', HOME)).toBe('/a/~/x.db');
  });

  it('replaces every occurrence of the placeholder', () => {
    expect(expandSqlitePath('/q/{instance}/{instance}.db', 'qa@b', HOME)).toBe('/q/qa@b/qa@b.db');
  });
});

describe('isPerInstanceSqlitePath', () => {
  it('detects the placeholder', () => {
    expect(isPerInstanceSqlitePath('~/.fleex/qa/{instance}.db')).toBe(true);
    expect(isPerInstanceSqlitePath('/Users/o/.fleex/fleex.db')).toBe(false);
    expect(isPerInstanceSqlitePath(undefined)).toBe(false);
  });
});

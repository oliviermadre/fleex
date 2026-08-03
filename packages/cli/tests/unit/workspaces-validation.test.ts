import path from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  runRules,
  normalizeBasePath,
  WORKSPACES_RULES,
  type RuleContext,
} from '../../src/core/workspaces-validation.ts';

import type { Workspace } from '../../src/core/workspaces.ts';

const HOME = '/home/tester';

function ws(name: string, is_default: boolean, basePath?: string): Workspace {
  return { name, is_default, env: {}, ...(basePath ? { basePath } : {}) };
}

/** Workspace with a custom env block (for driver/sqlite-path rules). */
function wsEnv(name: string, env: Record<string, string>): Workspace {
  return { name, is_default: false, env };
}

/** Build a context with an explicit homedir and a stubbed fs (set of existing dirs). */
function ctx(workspaces: Workspace[], existingDirs: string[] = []): RuleContext {
  const set = new Set(existingDirs.map((d) => path.resolve(d)));
  return { workspaces, homedir: HOME, dirExists: (p) => set.has(path.resolve(p)) };
}

describe('normalizeBasePath', () => {
  it('expands a leading ~ then resolves', () => {
    expect(normalizeBasePath('~/projects', HOME)).toBe('/home/tester/projects');
  });
  it('resolves relative segments and trailing slashes', () => {
    expect(normalizeBasePath('/a/b/../projects/', HOME)).toBe('/a/projects');
  });
});

describe('single-default rule', () => {
  it('errors on more than one default', () => {
    const issues = runRules(ctx([ws('a', true), ws('b', true)]), ['config']);
    const e = issues.find((i) => i.rule === 'single-default');
    expect(e?.level).toBe('error');
    expect(e?.message).toMatch(/only one default/);
  });
  it('passes with one or zero defaults', () => {
    expect(
      runRules(ctx([ws('a', true), ws('b', false)]), ['config']).some(
        (i) => i.rule === 'single-default',
      ),
    ).toBe(false);
    expect(
      runRules(ctx([ws('a', false)]), ['config']).some((i) => i.rule === 'single-default'),
    ).toBe(false);
  });
});

describe('unique-base-path rule', () => {
  it('errors when two workspaces share a basePath (after ~ normalization)', () => {
    const issues = runRules(
      ctx([ws('a', true, '~/projects'), ws('b', false, '/home/tester/projects')]),
      ['config'],
    );
    const e = issues.find((i) => i.rule === 'unique-base-path');
    expect(e?.level).toBe('error');
    expect(e?.message).toMatch(/share the same basePath/);
    expect(e?.message).toContain('a, b');
  });
  it('passes when basePaths are distinct', () => {
    const issues = runRules(
      ctx([ws('a', true, '~/projects-tada'), ws('b', false, '~/projects-perso')]),
      ['config'],
    );
    expect(issues.some((i) => i.rule === 'unique-base-path')).toBe(false);
  });
  it('ignores workspaces without a basePath for duplicate detection', () => {
    const issues = runRules(ctx([ws('a', true), ws('b', false)]), ['config']);
    expect(issues.some((i) => i.rule === 'unique-base-path')).toBe(false);
  });
});

describe('unique-sqlite-path rule', () => {
  const sqlite = (name: string, p?: string) =>
    wsEnv(name, { FLEEX_STORAGE_DRIVER: 'sqlite', ...(p ? { FLEEX_SQLITE_PATH: p } : {}) });

  it('errors when two sqlite workspaces share a db file (after ~ normalization)', () => {
    const issues = runRules(
      ctx([sqlite('a', '~/.fleex/fleex.db'), sqlite('b', '/home/tester/.fleex/fleex.db')]),
      ['config'],
    );
    const e = issues.find((i) => i.rule === 'unique-sqlite-path');
    expect(e?.level).toBe('error');
    expect(e?.message).toMatch(/share the same database file/);
    expect(e?.message).toContain('a, b');
  });

  it('passes when sqlite paths are distinct', () => {
    const issues = runRules(ctx([sqlite('a', '~/.fleex/a.db'), sqlite('b', '~/.fleex/b.db')]), [
      'config',
    ]);
    expect(issues.some((i) => i.rule === 'unique-sqlite-path')).toBe(false);
  });

  it('ignores non-sqlite workspaces even if FLEEX_SQLITE_PATH coincides', () => {
    const supa = wsEnv('s', {
      FLEEX_STORAGE_DRIVER: 'supabase',
      FLEEX_SQLITE_PATH: '~/.fleex/fleex.db',
    });
    const issues = runRules(ctx([sqlite('a', '~/.fleex/fleex.db'), supa]), ['config']);
    expect(issues.some((i) => i.rule === 'unique-sqlite-path')).toBe(false);
  });

  it('skips sqlite workspaces without an explicit path', () => {
    const issues = runRules(ctx([sqlite('a'), sqlite('b')]), ['config']);
    expect(issues.some((i) => i.rule === 'unique-sqlite-path')).toBe(false);
  });
});

describe('state rules (doctor-only)', () => {
  it('base-path-present warns for workspaces with no basePath', () => {
    const issues = runRules(ctx([ws('a', true), ws('b', false, '~/p')]));
    const w = issues.find((i) => i.rule === 'base-path-present');
    expect(w?.level).toBe('warning');
    expect(w?.message).toContain("'a'");
  });
  it('base-path-exists warns when the dir is missing, passes when present', () => {
    const missing = runRules(ctx([ws('a', true, '~/projects')], []));
    expect(missing.some((i) => i.rule === 'base-path-exists')).toBe(true);
    const present = runRules(ctx([ws('a', true, '~/projects')], ['/home/tester/projects']));
    expect(present.some((i) => i.rule === 'base-path-exists')).toBe(false);
  });
  it('state rules do NOT run when only config kinds are requested', () => {
    const issues = runRules(ctx([ws('a', true)]), ['config']);
    expect(issues.some((i) => i.kind === 'state')).toBe(false);
    expect(issues.some((i) => i.rule === 'base-path-present')).toBe(false);
  });
});

describe('rule registry', () => {
  it('exposes config and state rules', () => {
    expect(WORKSPACES_RULES.some((r) => r.kind === 'config')).toBe(true);
    expect(WORKSPACES_RULES.some((r) => r.kind === 'state')).toBe(true);
  });
});

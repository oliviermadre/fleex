import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Workspace } from './workspaces.ts';

/**
 * Extensible (open-closed) validation for the global workspaces config.
 *
 * Each invariant is a {@link WorkspacesRule}; adding one means appending to
 * {@link WORKSPACES_RULES} — the runner, the command guard
 * (`validateWorkspacesConfig`), and `fleex doctor` all consume the same set
 * without modification.
 *
 * Two flavours, distinguished by `kind`:
 *  - `config`: pure invariants over the parsed config. Run by the command guard
 *    AND by doctor.
 *  - `state`: filesystem/runtime checks (e.g. does basePath exist on disk).
 *    Run only by doctor — never by the fast pre-command guard.
 */

export type IssueLevel = 'error' | 'warning';

export interface ValidationIssue {
  /** Rule that produced the issue (for telemetry / debugging). */
  rule: string;
  level: IssueLevel;
  message: string;
}

export interface RuleContext {
  /** Parsed workspaces (never null — legacy mode is handled by callers). */
  workspaces: Workspace[];
  /** Home directory, for `~` expansion in path comparisons. */
  homedir: string;
  /** Injected so `state` rules stay testable without touching the real fs. */
  dirExists(p: string): boolean;
}

export type RuleKind = 'config' | 'state';

export interface WorkspacesRule {
  name: string;
  kind: RuleKind;
  check(ctx: RuleContext): ValidationIssue[];
}

/** Normalize a path for comparison: expand a leading `~` then resolve. */
export function normalizeBasePath(p: string, homedir: string): string {
  const expanded = p.startsWith('~') ? p.replace(/^~/, homedir) : p;
  return path.resolve(expanded);
}

/** At most one workspace may be flagged `is_default`. */
const singleDefaultRule: WorkspacesRule = {
  name: 'single-default',
  kind: 'config',
  check(ctx) {
    const defaults = ctx.workspaces.filter((w) => w.is_default);
    if (defaults.length > 1) {
      return [{
        rule: 'single-default',
        level: 'error',
        message: `only one default workspace is allowed (found: ${defaults.map((w) => w.name).join(', ')}).`,
      }];
    }
    return [];
  },
};

/**
 * No two workspaces may share the same basePath (compared after `~`/resolve
 * normalization). Sharing a basePath means sharing a worktree root, which
 * collides on the cwd-routed hook fan-out.
 */
const uniqueBasePathRule: WorkspacesRule = {
  name: 'unique-base-path',
  kind: 'config',
  check(ctx) {
    const byNormalized = new Map<string, string[]>();
    for (const w of ctx.workspaces) {
      if (!w.basePath) continue;
      const key = normalizeBasePath(w.basePath, ctx.homedir);
      const names = byNormalized.get(key) ?? [];
      names.push(w.name);
      byNormalized.set(key, names);
    }
    const issues: ValidationIssue[] = [];
    for (const [key, names] of byNormalized) {
      if (names.length > 1) {
        issues.push({
          rule: 'unique-base-path',
          level: 'error',
          message: `workspaces ${names.join(', ')} share the same basePath (${key}) — each workspace needs a distinct base path.`,
        });
      }
    }
    return issues;
  },
};

/**
 * No two `driver=sqlite` workspaces may point at the same DB file (compared
 * after `~`/resolve normalization). Sharing one SQLite file across instances
 * corrupts it (WAL). Workspaces without an explicit FLEEX_SQLITE_PATH are
 * skipped (consistent with unique-base-path); self-update backfills them.
 */
const uniqueSqlitePathRule: WorkspacesRule = {
  name: 'unique-sqlite-path',
  kind: 'config',
  check(ctx) {
    const byNormalized = new Map<string, string[]>();
    for (const w of ctx.workspaces) {
      if (w.env?.['FLEEX_STORAGE_DRIVER'] !== 'sqlite') continue;
      const dbPath = w.env['FLEEX_SQLITE_PATH'];
      if (!dbPath) continue;
      const key = normalizeBasePath(dbPath, ctx.homedir);
      const names = byNormalized.get(key) ?? [];
      names.push(w.name);
      byNormalized.set(key, names);
    }
    const issues: ValidationIssue[] = [];
    for (const [key, names] of byNormalized) {
      if (names.length > 1) {
        issues.push({
          rule: 'unique-sqlite-path',
          level: 'error',
          message: `sqlite workspaces ${names.join(', ')} share the same database file (${key}) — each needs a distinct FLEEX_SQLITE_PATH.`,
        });
      }
    }
    return issues;
  },
};

/** Warn when a workspace has no basePath — it falls back to the server default and risks collisions. */
const basePathPresentRule: WorkspacesRule = {
  name: 'base-path-present',
  kind: 'state',
  check(ctx) {
    return ctx.workspaces
      .filter((w) => !w.basePath)
      .map((w) => ({
        rule: 'base-path-present',
        level: 'warning' as const,
        message: `workspace '${w.name}' has no basePath — it falls back to the server default and may collide with another workspace.`,
      }));
  },
};

/** Warn when a workspace's basePath does not exist on disk yet. */
const basePathExistsRule: WorkspacesRule = {
  name: 'base-path-exists',
  kind: 'state',
  check(ctx) {
    return ctx.workspaces
      .filter((w) => w.basePath && !ctx.dirExists(normalizeBasePath(w.basePath, ctx.homedir)))
      .map((w) => ({
        rule: 'base-path-exists',
        level: 'warning' as const,
        message: `workspace '${w.name}' basePath does not exist yet: ${normalizeBasePath(w.basePath!, ctx.homedir)}`,
      }));
  },
};

/**
 * The rule set. Add a rule here — nothing else changes (open-closed).
 */
export const WORKSPACES_RULES: WorkspacesRule[] = [
  singleDefaultRule,
  uniqueBasePathRule,
  uniqueSqlitePathRule,
  basePathPresentRule,
  basePathExistsRule,
];

/** Build a {@link RuleContext} backed by the real filesystem. */
export function makeRuleContext(workspaces: Workspace[]): RuleContext {
  return {
    workspaces,
    homedir: os.homedir(),
    dirExists: (p: string) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    },
  };
}

/**
 * Run every rule whose kind is in `kinds` (default: all) and flatten the issues.
 * Pass `['config']` for the fast pre-command guard; omit for doctor's full sweep.
 */
export function runRules(ctx: RuleContext, kinds?: RuleKind[]): ValidationIssue[] {
  const selected = kinds ? WORKSPACES_RULES.filter((r) => kinds.includes(r.kind)) : WORKSPACES_RULES;
  return selected.flatMap((r) => r.check(ctx));
}

import path from 'node:path';

/**
 * Decides whether *this* instance is allowed to fire scheduled routines.
 *
 * The claim in {@link RoutineSchedulerService} guarantees a due occurrence runs
 * exactly once across the cluster; it says nothing about *where*. On a single
 * machine that difference is the whole problem: `~/.fleex/repo` and every QA
 * worktree of the same workspace share one database, so an instance running an
 * unmerged feature branch is just as eligible to win a claim as the canonical
 * install — and would then execute a production routine with in-development
 * code, in the shared `basePath`, posting real comments and PRs.
 *
 * So the scheduler is armed on the canonical install only. That is a placement
 * rule, not a safety net: whichever instance is armed still goes through the
 * claim, and two armed machines (a laptop and a desktop on the same Supabase)
 * remain perfectly correct — the first one awake takes the occurrence, which is
 * exactly the availability a static "master machine" flag would throw away.
 *
 * Precedence, highest first:
 *  1. `FLEEX_ROUTINE_SCHEDULER` — an explicit `on` / `off` always wins, so a
 *     worktree can be armed on purpose to test a routine end to end.
 *  2. A canonical install exists on disk → armed only when this process runs
 *     from it.
 *  3. No canonical install (a plain dev checkout, a container, a cloud
 *     deployment) → armed. There is no `~/.fleex/repo` for the instance to be
 *     "not", and disarming here would silently stop routines for every
 *     deployment that never used the installer.
 *
 * Pure: every environment lookup is injected, so the whole decision table is
 * testable without a filesystem.
 */

export type SchedulerRoleReason =
  | 'forced-on'
  | 'forced-off'
  | 'canonical-install'
  | 'secondary-instance'
  | 'no-canonical-install';

export interface SchedulerRole {
  armed: boolean;
  reason: SchedulerRoleReason;
  /** One line, fit to log at boot and to serve to the UI. */
  detail: string;
}

export interface SchedulerRoleInputs {
  env: Record<string, string | undefined>;
  /** Repo root this server runs from — `FLEEX_REPO_DIR`, else the cwd. */
  repoDir: string;
  homedir: string;
  dirExists(p: string): boolean;
  /**
   * Resolves symlinks. `~/.fleex/repo` is a symlink to a working checkout in
   * some contributor setups, and `process.cwd()` reports the resolved path —
   * comparing the two unresolved would disarm the canonical instance.
   * Implementations must return the input unchanged when the path is
   * unreadable.
   */
  realPath(p: string): string;
}

export const SCHEDULER_ENV_VAR = 'FLEEX_ROUTINE_SCHEDULER';

const TRUTHY = new Set(['1', 'on', 'true', 'yes']);
const FALSY = new Set(['0', 'off', 'false', 'no']);

/** `$FLEEX_HOME/repo`, or `~/.fleex/repo` — the path the installer writes to. */
export function canonicalRepoDir(env: Record<string, string | undefined>, homedir: string): string {
  return path.join(env['FLEEX_HOME'] ?? path.join(homedir, '.fleex'), 'repo');
}

export function resolveSchedulerRole(inputs: SchedulerRoleInputs): SchedulerRole {
  const forced = inputs.env[SCHEDULER_ENV_VAR]?.trim().toLowerCase();
  if (forced && TRUTHY.has(forced)) {
    return { armed: true, reason: 'forced-on', detail: `${SCHEDULER_ENV_VAR}=${forced}` };
  }
  if (forced && FALSY.has(forced)) {
    return { armed: false, reason: 'forced-off', detail: `${SCHEDULER_ENV_VAR}=${forced}` };
  }

  const canonical = canonicalRepoDir(inputs.env, inputs.homedir);
  if (!inputs.dirExists(canonical)) {
    return {
      armed: true,
      reason: 'no-canonical-install',
      detail: `no canonical install at ${canonical} — this is the only instance`,
    };
  }

  const here = normalize(inputs.realPath(path.resolve(inputs.repoDir)));
  const there = normalize(inputs.realPath(canonical));
  if (here === there) {
    return { armed: true, reason: 'canonical-install', detail: `running from ${canonical}` };
  }
  return {
    armed: false,
    reason: 'secondary-instance',
    detail:
      `running from ${inputs.repoDir}, not the canonical install (${canonical}) — `
      + `routines are scheduled there. Set ${SCHEDULER_ENV_VAR}=on to schedule from here too.`,
  };
}

/** Trailing separators are noise on a directory comparison. */
function normalize(p: string): string {
  return p.length > 1 ? p.replace(/[\\/]+$/, '') : p;
}

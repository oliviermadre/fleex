import { describe, it, expect } from 'vitest';
import {
  resolveSchedulerRole,
  canonicalRepoDir,
  SCHEDULER_ENV_VAR,
  type SchedulerRoleInputs,
} from '../../src/domain/services/scheduler-role.js';

const HOME = '/home/olivier';
const CANONICAL = `${HOME}/.fleex/repo`;
const WORKTREE = `${HOME}/dev/fleex-worktrees/feat-routines`;

/** Defaults describe the canonical install; each test overrides what it means. */
function inputs(over: Partial<SchedulerRoleInputs> = {}): SchedulerRoleInputs {
  return {
    env: {},
    repoDir: CANONICAL,
    homedir: HOME,
    dirExists: (p) => p === CANONICAL,
    realPath: (p) => p,
    ...over,
  };
}

describe('resolveSchedulerRole — which instance is allowed to fire schedules', () => {
  it('arms the canonical install', () => {
    const role = resolveSchedulerRole(inputs());
    expect(role.armed).toBe(true);
    expect(role.reason).toBe('canonical-install');
  });

  it('disarms a worktree instance sharing the same database', () => {
    // The case the whole rule exists for: a QA instance running an unmerged
    // branch is just as eligible to win a claim as the main install, and would
    // execute a production routine with in-development code.
    const role = resolveSchedulerRole(inputs({ repoDir: WORKTREE }));
    expect(role.armed).toBe(false);
    expect(role.reason).toBe('secondary-instance');
    // The message has to name the escape hatch — a disarmed instance is
    // otherwise indistinguishable from a broken one.
    expect(role.detail).toContain(SCHEDULER_ENV_VAR);
    expect(role.detail).toContain(CANONICAL);
  });

  it('arms a plain checkout when no canonical install exists', () => {
    // A dev clone, a container, a cloud deployment: there is no `~/.fleex/repo`
    // for this instance to be "not", and disarming would silently stop every
    // routine for anyone who never ran the installer.
    const role = resolveSchedulerRole(inputs({
      repoDir: '/srv/fleex',
      dirExists: () => false,
    }));
    expect(role.armed).toBe(true);
    expect(role.reason).toBe('no-canonical-install');
  });

  it('lets the env var arm a worktree on purpose', () => {
    const role = resolveSchedulerRole(inputs({
      repoDir: WORKTREE,
      env: { [SCHEDULER_ENV_VAR]: 'on' },
    }));
    expect(role.armed).toBe(true);
    expect(role.reason).toBe('forced-on');
  });

  it('lets the env var disarm the canonical install', () => {
    // The other half of the escape hatch: silencing one machine of a
    // two-machine setup without touching its workspace config.
    const role = resolveSchedulerRole(inputs({ env: { [SCHEDULER_ENV_VAR]: 'off' } }));
    expect(role.armed).toBe(false);
    expect(role.reason).toBe('forced-off');
  });

  it('accepts the usual spellings of on and off', () => {
    for (const on of ['1', 'ON', 'true', ' yes ']) {
      expect(resolveSchedulerRole(inputs({ repoDir: WORKTREE, env: { [SCHEDULER_ENV_VAR]: on } })).armed)
        .toBe(true);
    }
    for (const off of ['0', 'OFF', 'false', ' no ']) {
      expect(resolveSchedulerRole(inputs({ env: { [SCHEDULER_ENV_VAR]: off } })).armed).toBe(false);
    }
  });

  it('ignores an unparseable env value rather than guessing', () => {
    // "maybe" is not an intent. Falling through to the location rule is the
    // safe reading; treating it as "on" would arm every worktree on a typo.
    const role = resolveSchedulerRole(inputs({ repoDir: WORKTREE, env: { [SCHEDULER_ENV_VAR]: 'maybe' } }));
    expect(role.armed).toBe(false);
    expect(role.reason).toBe('secondary-instance');
  });

  it('arms the canonical install when it is a symlink to the running checkout', () => {
    // `~/.fleex/repo` is a symlink in some contributor setups and the process
    // reports the resolved cwd. Comparing the two unresolved would disarm the
    // one instance that must be armed.
    const real = '/home/olivier/code/fleex';
    const role = resolveSchedulerRole(inputs({
      repoDir: real,
      realPath: (p) => (p === CANONICAL ? real : p),
    }));
    expect(role.armed).toBe(true);
    expect(role.reason).toBe('canonical-install');
  });

  it('is not fooled by a trailing separator', () => {
    expect(resolveSchedulerRole(inputs({ repoDir: `${CANONICAL}/` })).armed).toBe(true);
  });

  it('honours FLEEX_HOME when locating the canonical install', () => {
    // Tests and side-by-side installs relocate ~/.fleex; the rule has to follow.
    const env = { FLEEX_HOME: '/tmp/fleex-home' };
    expect(canonicalRepoDir(env, HOME)).toBe('/tmp/fleex-home/repo');

    const role = resolveSchedulerRole(inputs({
      env,
      repoDir: '/tmp/fleex-home/repo',
      dirExists: (p) => p === '/tmp/fleex-home/repo',
    }));
    expect(role.armed).toBe(true);
    expect(role.reason).toBe('canonical-install');
  });
});

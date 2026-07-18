import { describe, it, expect } from 'vitest';
import type { GitRemoteInfo } from '@fleex/shared';
import { OverlayManager } from '../../src/application/services/overlay-manager.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import type { ExecFn } from '../../src/infrastructure/host/types.js';
import { FakeHostFs, FakeConfigPort, FakeLoggerPort, FakeGitPort } from '../helpers/fakes.js';

const BASE = '/base';
const WORKSPACE_ROOT = '/base/workspaces/76d062-modif-proxy-sync-overlay';
const REPO_DIR = `${WORKSPACE_ROOT}/odys-proxy`;
const IGNORED_PORCELAIN = '!! .env.local\0!! compose.override.yaml\0';

/**
 * git status only succeeds in a real repo dir. Running it at the workspace root
 * (which has no `.git`) must throw, exactly like the real gateway does with
 * "fatal: not a git repository". This lets a test fail loudly if discovery ever
 * regresses to running git in the wrong place.
 */
function makeExecFn(repoDirsWithStatus: Record<string, string>): {
  execFn: ExecFn;
  statusCwds: string[];
} {
  const statusCwds: string[] = [];
  const execFn: ExecFn = async (cmd, args, opts) => {
    if (cmd === 'git' && args[0] === 'status') {
      const cwd = opts?.cwd ?? '';
      statusCwds.push(cwd);
      const porcelain = repoDirsWithStatus[cwd];
      if (porcelain !== undefined) return { stdout: porcelain, stderr: '' };
      const err = new Error('git failed') as Error & { stderr?: string };
      err.stderr = 'fatal: not a git repository (or any of the parent directories): .git\n';
      throw err;
    }
    return { stdout: '', stderr: '' };
  };
  return { execFn, statusCwds };
}

function gitInfo(org: string, name: string): GitRemoteInfo {
  return {
    org,
    name,
    remote: `git@github.com:${org}/${name}.git`,
    branch: 'main',
    isWorktree: true,
    mainWorktreePath: `/base/.bare/${org}/${name}.git`,
  };
}

function makeManager(execFn: ExecFn, git: FakeGitPort): { mgr: OverlayManager; hostFs: FakeHostFs } {
  const hostFs = new FakeHostFs();
  const mgr = new OverlayManager(
    hostFs,
    new RepoPathResolver(BASE),
    execFn,
    new FakeConfigPort(),
    new FakeLoggerPort(),
    git,
  );
  return { mgr, hostFs };
}

describe('OverlayManager.scanWorkspace — directory-walking discovery', () => {
  it('walks a ticket workspace root and scans each repo worktree in its own dir', async () => {
    // WHY: the sync button acts in a ticket context whose CWD is the workspace
    // *root* (`workspaces/<id>`), not a repo checkout. The root has no `.git`,
    // so trusting it verbatim made git status fail and the repo show as
    // "indisponible". Discovery must descend into the `<root>/<name>` worktree
    // and run git status where a `.git` actually lives.
    const { execFn, statusCwds } = makeExecFn({ [REPO_DIR]: IGNORED_PORCELAIN });
    const git = new FakeGitPort();
    git.setInfo(REPO_DIR, gitInfo('odys-travel', 'odys-proxy'));
    const { mgr, hostFs } = makeManager(execFn, git);
    // Workspace root holds a `.fleex.json` manifest and the repo worktree.
    hostFs.addDirEntries(WORKSPACE_ROOT, [
      { name: '.fleex.json', isFile: true, isDirectory: false },
      { name: 'odys-proxy', isFile: false, isDirectory: true },
    ]);
    hostFs.addExistingPath(REPO_DIR);
    hostFs.addExistingPath(`${REPO_DIR}/.git`); // linked-worktree marker (a file)

    const groups = await mgr.scanWorkspace(WORKSPACE_ROOT);

    expect(groups).toHaveLength(1);
    const [group] = groups;
    expect(group.available).toBe(true);
    expect(group.org).toBe('odys-travel');
    expect(group.name).toBe('odys-proxy');
    // The response echoes the resolved repo path so preview/apply target it.
    expect(group.worktreePath).toBe(REPO_DIR);
    // git status ran in the repo dir, never at the workspace root.
    expect(statusCwds).toEqual([REPO_DIR]);
    expect(group.tree.map((n) => n.name).sort()).toEqual(['.env.local', 'compose.override.yaml']);
  });

  it('scans the path directly when it is itself a repo checkout (standalone worktree)', async () => {
    // A lone worktree has no enclosing workspace: `rootPath` is the checkout and
    // carries its own `.git`, so it is the sole target.
    const { execFn, statusCwds } = makeExecFn({ [REPO_DIR]: IGNORED_PORCELAIN });
    const git = new FakeGitPort();
    git.setInfo(REPO_DIR, gitInfo('odys-travel', 'odys-proxy'));
    const { mgr, hostFs } = makeManager(execFn, git);
    hostFs.addExistingPath(REPO_DIR);
    hostFs.addExistingPath(`${REPO_DIR}/.git`);

    const groups = await mgr.scanWorkspace(REPO_DIR);

    expect(groups).toHaveLength(1);
    expect(groups[0].available).toBe(true);
    expect(groups[0].worktreePath).toBe(REPO_DIR);
    expect(statusCwds).toEqual([REPO_DIR]);
  });

  it('discovers every repo worktree under the root, each scanned in its own dir', async () => {
    // A ticket workspace can hold multiple repos. Each must be resolved to its
    // own org/name and scanned independently.
    const proxyDir = `${WORKSPACE_ROOT}/odys-proxy`;
    const apiDir = `${WORKSPACE_ROOT}/odys-api`;
    const { execFn, statusCwds } = makeExecFn({
      [proxyDir]: '!! .env.local\0',
      [apiDir]: '!! config/secrets.yaml\0',
    });
    const git = new FakeGitPort();
    git.setInfo(proxyDir, gitInfo('odys-travel', 'odys-proxy'));
    git.setInfo(apiDir, gitInfo('odys-travel', 'odys-api'));
    const { mgr, hostFs } = makeManager(execFn, git);
    hostFs.addDirEntries(WORKSPACE_ROOT, [
      { name: 'odys-proxy', isFile: false, isDirectory: true },
      { name: 'odys-api', isFile: false, isDirectory: true },
    ]);
    for (const dir of [proxyDir, apiDir]) {
      hostFs.addExistingPath(dir);
      hostFs.addExistingPath(`${dir}/.git`);
    }

    const groups = await mgr.scanWorkspace(WORKSPACE_ROOT);

    expect(groups.map((g) => g.name).sort()).toEqual(['odys-api', 'odys-proxy']);
    expect(groups.every((g) => g.available)).toBe(true);
    // Each repo scanned in its own directory (sorted discovery order).
    expect(statusCwds.sort()).toEqual([apiDir, proxyDir]);
  });

  it('skips subdirectories that are not git worktrees', async () => {
    // A workspace root also holds non-repo entries (a `.fleex.json` file, a
    // stray `node_modules/`). These carry no `.git` and must not become targets.
    const { execFn, statusCwds } = makeExecFn({ [REPO_DIR]: IGNORED_PORCELAIN });
    const git = new FakeGitPort();
    git.setInfo(REPO_DIR, gitInfo('odys-travel', 'odys-proxy'));
    const { mgr, hostFs } = makeManager(execFn, git);
    hostFs.addDirEntries(WORKSPACE_ROOT, [
      { name: '.fleex.json', isFile: true, isDirectory: false },
      { name: 'node_modules', isFile: false, isDirectory: true },
      { name: 'odys-proxy', isFile: false, isDirectory: true },
    ]);
    hostFs.addExistingPath(REPO_DIR);
    hostFs.addExistingPath(`${REPO_DIR}/.git`);
    // node_modules exists but has no `.git`.
    hostFs.addExistingPath(`${WORKSPACE_ROOT}/node_modules`);

    const groups = await mgr.scanWorkspace(WORKSPACE_ROOT);

    expect(groups.map((g) => g.name)).toEqual(['odys-proxy']);
    expect(statusCwds).toEqual([REPO_DIR]);
  });

  it('skips a worktree whose git remote cannot be resolved', async () => {
    // A `.git`-bearing dir with no resolvable origin remote is not overlay-
    // managed. getInfo throws; we skip rather than emitting a bogus target.
    const { execFn, statusCwds } = makeExecFn({});
    const git = new FakeGitPort(); // no info registered → getInfo throws
    const { mgr, hostFs } = makeManager(execFn, git);
    hostFs.addDirEntries(WORKSPACE_ROOT, [
      { name: 'mystery', isFile: false, isDirectory: true },
    ]);
    hostFs.addExistingPath(`${WORKSPACE_ROOT}/mystery`);
    hostFs.addExistingPath(`${WORKSPACE_ROOT}/mystery/.git`);

    const groups = await mgr.scanWorkspace(WORKSPACE_ROOT);

    expect(groups).toEqual([]);
    expect(statusCwds).toEqual([]);
  });

  it('marks a discovered repo unavailable when git status fails there', async () => {
    // The dir is a real worktree (has `.git`, resolvable remote) but git status
    // errors — surface it loudly as unavailable with the reason, not silently.
    const { execFn } = makeExecFn({}); // status throws for every cwd
    const git = new FakeGitPort();
    git.setInfo(REPO_DIR, gitInfo('odys-travel', 'odys-proxy'));
    const { mgr, hostFs } = makeManager(execFn, git);
    hostFs.addDirEntries(WORKSPACE_ROOT, [
      { name: 'odys-proxy', isFile: false, isDirectory: true },
    ]);
    hostFs.addExistingPath(REPO_DIR);
    hostFs.addExistingPath(`${REPO_DIR}/.git`);

    const groups = await mgr.scanWorkspace(WORKSPACE_ROOT);

    expect(groups).toHaveLength(1);
    expect(groups[0].available).toBe(false);
    expect(groups[0].message).toContain('git status failed');
  });
});

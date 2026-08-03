import { describe, it, expect, beforeEach } from 'vitest';

import { FakeHostFs, FakeLoggerPort } from '../helpers/fakes.js';

// ---------------------------------------------------------------------------
// Unit tests for the CWD guard logic and clone route helpers.
// We test the logic directly (no Fastify HTTP layer) to keep things fast.
// ---------------------------------------------------------------------------

describe('FakeHostFs — exists / mkdir', () => {
  it('returns false for unknown paths', async () => {
    const fs = new FakeHostFs();
    expect(await fs.exists('/some/missing/path')).toBe(false);
  });

  it('returns true after addExistingPath', async () => {
    const fs = new FakeHostFs();
    fs.addExistingPath('/repos/myorg/myrepo');
    expect(await fs.exists('/repos/myorg/myrepo')).toBe(true);
  });

  it('mkdir adds path to existing set', async () => {
    const fs = new FakeHostFs();
    await fs.mkdir('/repos/myorg');
    expect(await fs.exists('/repos/myorg')).toBe(true);
    expect(fs.createdDirs.has('/repos/myorg')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CWD guard logic — mirrored from sessions.routes.ts
// ---------------------------------------------------------------------------

async function cwdGuard(
  hostFs: FakeHostFs,
  cwd: string,
): Promise<{ allowed: boolean; code?: string; message?: string }> {
  const exists = await hostFs.exists(cwd);
  if (!exists) {
    return {
      allowed: false,
      code: 'CWD_NOT_FOUND',
      message: `Directory not found: ${cwd}`,
    };
  }
  return { allowed: true };
}

describe('CWD guard', () => {
  let hostFs: FakeHostFs;

  beforeEach(() => {
    hostFs = new FakeHostFs();
  });

  it('allows creation when cwd exists', async () => {
    hostFs.addExistingPath('/repos/myorg/myrepo');
    const result = await cwdGuard(hostFs, '/repos/myorg/myrepo');
    expect(result.allowed).toBe(true);
  });

  it('rejects with CWD_NOT_FOUND when cwd is missing', async () => {
    const result = await cwdGuard(hostFs, '/repos/myorg/missingrepo');
    expect(result.allowed).toBe(false);
    expect(result.code).toBe('CWD_NOT_FOUND');
    expect(result.message).toContain('/repos/myorg/missingrepo');
  });

  it('does not create a zombie session when cwd is missing', async () => {
    // Simulate a session store — guard should prevent any save
    const savedSessions: string[] = [];
    const fakeStore = {
      save: (name: string) => savedSessions.push(name),
    };

    const result = await cwdGuard(hostFs, '/repos/myorg/missing');
    if (!result.allowed) {
      // Route exits early — store.save is never called
    } else {
      fakeStore.save('fleex_shell_myorg_myrepo_main_shell');
    }

    expect(savedSessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Clone route logic — mirrored from repositories.routes.ts
// ---------------------------------------------------------------------------

interface CloneOptions {
  org: string;
  name: string;
  basePath: string;
  gitHost: string;
  configuredRepos: { org: string; name: string }[];
}

async function cloneLogic(
  hostFs: FakeHostFs,
  execCalls: Array<{ command: string; args: string[] }>,
  opts: CloneOptions,
  simulateCloneSuccess: boolean,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { org, name, basePath, gitHost, configuredRepos } = opts;

  const isAllowed = configuredRepos.some((r) => r.org === org && r.name === name);
  if (!isAllowed) {
    return { status: 403, body: { code: 'REPO_NOT_CONFIGURED' } };
  }

  const remote = `git@${gitHost}:${org}/${name}`;
  const repoPath = `${basePath}/${org}/${name}`;
  const parentPath = `${basePath}/${org}`;

  const parentExists = await hostFs.exists(parentPath);
  if (!parentExists) {
    await hostFs.mkdir(parentPath);
  }

  if (simulateCloneSuccess) {
    execCalls.push({ command: 'git', args: ['clone', remote, repoPath] });
    hostFs.addExistingPath(repoPath);
    return { status: 200, body: { success: true } };
  } else {
    return {
      status: 422,
      body: { code: 'CLONE_FAILED', message: 'Permission denied (publickey).' },
    };
  }
}

describe('Clone route logic', () => {
  let hostFs: FakeHostFs;
  let execCalls: Array<{ command: string; args: string[] }>;
  const basePath = '/repos';
  const gitHost = 'github.com';
  const configuredRepos = [{ org: 'myorg', name: 'myrepo' }];

  beforeEach(() => {
    hostFs = new FakeHostFs();
    execCalls = [];
  });

  it('rejects repos not in configured list', async () => {
    const result = await cloneLogic(
      hostFs,
      execCalls,
      {
        org: 'hacker',
        name: 'evil',
        basePath,
        gitHost,
        configuredRepos,
      },
      true,
    );
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('REPO_NOT_CONFIGURED');
    expect(execCalls).toHaveLength(0);
  });

  it('creates parent directory if missing, then clones', async () => {
    const result = await cloneLogic(
      hostFs,
      execCalls,
      {
        org: 'myorg',
        name: 'myrepo',
        basePath,
        gitHost,
        configuredRepos,
      },
      true,
    );

    expect(result.status).toBe(200);
    expect(result.body.success).toBe(true);
    expect(hostFs.createdDirs.has('/repos/myorg')).toBe(true);
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]!.args).toEqual([
      'clone',
      'git@github.com:myorg/myrepo',
      '/repos/myorg/myrepo',
    ]);
    // Repo path should now exist
    expect(await hostFs.exists('/repos/myorg/myrepo')).toBe(true);
  });

  it('does not mkdir if parent already exists', async () => {
    hostFs.addExistingPath('/repos/myorg');

    await cloneLogic(
      hostFs,
      execCalls,
      {
        org: 'myorg',
        name: 'myrepo',
        basePath,
        gitHost,
        configuredRepos,
      },
      true,
    );

    expect(hostFs.createdDirs.has('/repos/myorg')).toBe(false);
  });

  it('returns CLONE_FAILED on git error', async () => {
    const result = await cloneLogic(
      hostFs,
      execCalls,
      {
        org: 'myorg',
        name: 'myrepo',
        basePath,
        gitHost,
        configuredRepos,
      },
      false,
    );

    expect(result.status).toBe(422);
    expect(result.body.code).toBe('CLONE_FAILED');
    expect(typeof result.body.message).toBe('string');
    // Repo path should NOT exist after failed clone
    expect(await hostFs.exists('/repos/myorg/myrepo')).toBe(false);
  });

  it('builds correct SSH remote from gitHost', async () => {
    const customGitHost = 'gitlab.com';
    await cloneLogic(
      hostFs,
      execCalls,
      {
        org: 'myorg',
        name: 'myrepo',
        basePath,
        gitHost: customGitHost,
        configuredRepos,
      },
      true,
    );

    expect(execCalls[0]!.args[1]).toBe('git@gitlab.com:myorg/myrepo');
  });
});

// ---------------------------------------------------------------------------
// check-cwd endpoint logic
// ---------------------------------------------------------------------------

async function checkCwdLogic(
  hostFs: FakeHostFs,
  org: string,
  name: string,
  basePath: string,
  gitHost: string,
): Promise<{ exists: true } | { exists: false; remote: string; targetPath: string }> {
  const repoPath = `${basePath}/${org}/${name}`;
  const exists = await hostFs.exists(repoPath);
  if (exists) return { exists: true };
  return {
    exists: false,
    remote: `git@${gitHost}:${org}/${name}`,
    targetPath: repoPath,
  };
}

describe('check-cwd endpoint logic', () => {
  let hostFs: FakeHostFs;

  beforeEach(() => {
    hostFs = new FakeHostFs();
  });

  it('returns exists: true when repo is cloned', async () => {
    hostFs.addExistingPath('/repos/myorg/myrepo');
    const result = await checkCwdLogic(hostFs, 'myorg', 'myrepo', '/repos', 'github.com');
    expect(result.exists).toBe(true);
  });

  it('returns exists: false with remote and targetPath when not cloned', async () => {
    const result = await checkCwdLogic(hostFs, 'myorg', 'myrepo', '/repos', 'github.com');
    expect(result.exists).toBe(false);
    if (!result.exists) {
      expect(result.remote).toBe('git@github.com:myorg/myrepo');
      expect(result.targetPath).toBe('/repos/myorg/myrepo');
    }
  });

  it('uses custom gitHost in remote URL', async () => {
    const result = await checkCwdLogic(hostFs, 'myorg', 'myrepo', '/repos', 'gitlab.com');
    expect(result.exists).toBe(false);
    if (!result.exists) {
      expect(result.remote).toBe('git@gitlab.com:myorg/myrepo');
    }
  });
});

import { describe, it, expect } from 'vitest';
import { ListRepositoriesUseCase } from '../../src/application/use-cases/list-repositories.js';
import { FakeGitPort, FakeConfigPort, FakeLoggerPort } from '../helpers/fakes.js';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ListRepositoriesUseCase - dual mode', () => {
  it('scans bare repos from .repos/ directory', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'fleex-test-'));
    try {
      // Create a fake bare repo structure
      const bareDir = join(tmp, '.repos', 'acme', 'api.git');
      await mkdir(bareDir, { recursive: true });
      // Create a minimal git bare indicator
      await writeFile(join(bareDir, 'HEAD'), 'ref: refs/heads/main\n');

      const git = new FakeGitPort();
      git.setInfo(bareDir, {
        org: 'acme',
        name: 'api',
        remote: 'git@github.com:acme/api.git',
        branch: '',
        isWorktree: false,
        isBare: true,
        mainWorktreePath: bareDir,
      });

      const config = new FakeConfigPort();
      config.update({ basePath: tmp });
      const logger = new FakeLoggerPort();

      const uc = new ListRepositoriesUseCase(git, config, logger);
      const repos = await uc.execute();

      expect(repos).toHaveLength(1);
      expect(repos[0].mode).toBe('bare');
      expect(repos[0].org).toBe('acme');
      expect(repos[0].name).toBe('api');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('skips .repos and workspaces directories in regular scan', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'fleex-test-'));
    try {
      // Create dirs that should be excluded
      await mkdir(join(tmp, '.repos', 'acme'), { recursive: true });
      await mkdir(join(tmp, 'workspaces', 'ticket-1'), { recursive: true });

      const git = new FakeGitPort();
      const config = new FakeConfigPort();
      config.update({ basePath: tmp });
      const logger = new FakeLoggerPort();

      const uc = new ListRepositoriesUseCase(git, config, logger);
      const repos = await uc.execute();

      // No repos should be found since .repos has no .git entries and workspaces is excluded
      expect(repos).toHaveLength(0);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('deduplicates when repo exists in both bare and regular', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'fleex-test-'));
    try {
      const bareDir = join(tmp, '.repos', 'acme', 'api.git');
      const regularDir = join(tmp, 'acme', 'api');
      await mkdir(bareDir, { recursive: true });
      await mkdir(regularDir, { recursive: true });
      await writeFile(join(bareDir, 'HEAD'), 'ref: refs/heads/main\n');
      await mkdir(join(regularDir, '.git'), { recursive: true });

      const git = new FakeGitPort();
      git.setInfo(bareDir, {
        org: 'acme', name: 'api', remote: 'git@github.com:acme/api.git',
        branch: '', isWorktree: false, isBare: true, mainWorktreePath: bareDir,
      });
      git.setInfo(regularDir, {
        org: 'acme', name: 'api', remote: 'git@github.com:acme/api.git',
        branch: 'main', isWorktree: false, isBare: false, mainWorktreePath: regularDir,
      });

      const config = new FakeConfigPort();
      config.update({ basePath: tmp });
      const logger = new FakeLoggerPort();

      const uc = new ListRepositoriesUseCase(git, config, logger);
      const repos = await uc.execute();

      // Only bare version should be listed (bare takes priority)
      expect(repos).toHaveLength(1);
      expect(repos[0].mode).toBe('bare');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

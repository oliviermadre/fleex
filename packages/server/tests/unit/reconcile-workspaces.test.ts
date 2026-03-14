import { describe, it, expect } from 'vitest';
import { ReconcileWorkspacesUseCase } from '../../src/application/use-cases/reconcile-workspaces.js';
import { CreateWorktreeUseCase } from '../../src/application/use-cases/create-worktree.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { FakeGitPort, FakeConfigPort, FakeLoggerPort, FakeHostFs, FakeWorkspaceStore } from '../helpers/fakes.js';

function setup() {
  const git = new FakeGitPort();
  const config = new FakeConfigPort();
  config.update({ basePath: '/base' });
  const logger = new FakeLoggerPort();
  const hostFs = new FakeHostFs();
  const workspaceStore = new FakeWorkspaceStore();
  const resolver = new RepoPathResolver(hostFs.exists.bind(hostFs));
  const createWorktree = new CreateWorktreeUseCase(git, logger);
  const uc = new ReconcileWorkspacesUseCase(
    workspaceStore, resolver, createWorktree, git, config, hostFs, logger,
  );
  return { uc, workspaceStore, hostFs, git };
}

describe('ReconcileWorkspacesUseCase', () => {
  it('returns ok when all worktrees exist', async () => {
    const { uc, workspaceStore, hostFs } = setup();

    // Simulate a workspace with a bare repo
    await workspaceStore.save({
      ticketId: 'ticket-1',
      repos: [{ org: 'acme', name: 'api', branch: 'ticket/abc-feature', bare: true }],
      createdAt: new Date().toISOString(),
    });

    // Mark paths as existing
    hostFs.addExistingPath('/base/.repos/acme/api.git');
    hostFs.addExistingPath('/base/workspaces/ticket-1/acme/api');

    const result = await uc.execute();

    expect(result.total).toBe(1);
    expect(result.ok).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.orphaned).toHaveLength(0);
  });

  it('detects orphan workspace directories', async () => {
    const { uc, hostFs } = setup();

    // No persisted workspaces, but a directory exists
    hostFs.addExistingPath('/base/workspaces');
    // Override readdir to return an orphan directory
    hostFs.readdir = async () => [
      { name: 'orphan-ticket', isFile: false, isDirectory: true },
    ];

    const result = await uc.execute();

    expect(result.orphaned).toContain('orphan-ticket');
  });

  it('reports 0 total when no workspaces exist', async () => {
    const { uc } = setup();

    const result = await uc.execute();

    expect(result.total).toBe(0);
    expect(result.ok).toBe(0);
    expect(result.repaired).toBe(0);
    expect(result.orphaned).toHaveLength(0);
  });
});

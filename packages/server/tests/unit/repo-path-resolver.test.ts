import { describe, it, expect } from 'vitest';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';

describe('RepoPathResolver', () => {
  it('resolves bare repo when .repos/org/name.git exists', async () => {
    const existingPaths = new Set(['/base/.repos/acme/api.git']);
    const resolver = new RepoPathResolver((p) => Promise.resolve(existingPaths.has(p)));

    const result = await resolver.resolve('/base', 'acme', 'api');

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('bare');
    expect(result!.repoPath).toBe('/base/.repos/acme/api.git');
    expect(result!.envSourcePath).toBe('/base/.repos/acme/api.env');
  });

  it('resolves regular repo when org/name exists', async () => {
    const existingPaths = new Set(['/base/acme/api']);
    const resolver = new RepoPathResolver((p) => Promise.resolve(existingPaths.has(p)));

    const result = await resolver.resolve('/base', 'acme', 'api');

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('regular');
    expect(result!.repoPath).toBe('/base/acme/api');
    expect(result!.envSourcePath).toBe('/base/acme/api');
  });

  it('prefers bare over regular when both exist', async () => {
    const existingPaths = new Set(['/base/.repos/acme/api.git', '/base/acme/api']);
    const resolver = new RepoPathResolver((p) => Promise.resolve(existingPaths.has(p)));

    const result = await resolver.resolve('/base', 'acme', 'api');

    expect(result).not.toBeNull();
    expect(result!.mode).toBe('bare');
  });

  it('returns null when neither exists', async () => {
    const resolver = new RepoPathResolver(() => Promise.resolve(false));

    const result = await resolver.resolve('/base', 'acme', 'api');

    expect(result).toBeNull();
  });

  it('computes worktree path correctly', () => {
    const resolver = new RepoPathResolver(() => Promise.resolve(false));

    const path = resolver.worktreePath('/base', 'ticket-123', 'acme', 'api');

    expect(path).toBe('/base/workspaces/ticket-123/acme/api');
  });
});

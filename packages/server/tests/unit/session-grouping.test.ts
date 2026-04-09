import { describe, it, expect } from 'vitest';
import { SessionGroupingService } from '../../src/domain/services/session-grouping.js';
import { SessionEntity } from '../../src/domain/entities.js';

describe('SessionGroupingService', () => {
  const service = new SessionGroupingService();

  function makeSession(
    id: string,
    org: string | null,
    repo: string | null,
    branch: string | null,
  ): SessionEntity {
    return new SessionEntity(
      id, `fleex_shell_${id}`, 'shell', 'running',
      `/projects/${org}/${repo}`, new Date(), null,
      org, repo, branch, null,
    );
  }

  it('should group sessions by repo and worktree', async () => {
    const sessions = [
      makeSession('1', 'org', 'repo1', 'main'),
      makeSession('2', 'org', 'repo1', 'main'),
      makeSession('3', 'org', 'repo1', 'feature'),
      makeSession('4', 'org', 'repo2', 'main'),
    ];

    const groups = await service.groupSessions(sessions);

    expect(groups).toHaveLength(2);

    const repo1 = groups.find((g) => g.repositoryName === 'repo1');
    expect(repo1).toBeDefined();
    expect(repo1!.worktrees).toHaveLength(2);

    const mainWt = repo1!.worktrees.find((w) => w.branch === 'main');
    expect(mainWt!.sessions).toHaveLength(2);

    const featureWt = repo1!.worktrees.find((w) => w.branch === 'feature');
    expect(featureWt!.sessions).toHaveLength(1);

    const repo2 = groups.find((g) => g.repositoryName === 'repo2');
    expect(repo2!.worktrees).toHaveLength(1);
  });

  it('should handle sessions without repo info', async () => {
    const sessions = [
      makeSession('1', null, null, null),
    ];

    const groups = await service.groupSessions(sessions);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.repositoryOrg).toBe('_ungrouped');
  });

  it('should return empty array for no sessions', async () => {
    expect(await service.groupSessions([])).toEqual([]);
  });
});

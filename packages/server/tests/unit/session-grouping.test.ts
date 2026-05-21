import { describe, it, expect, vi } from 'vitest';
import { SessionGroupingService } from '../../src/domain/services/session-grouping.js';
import { SessionEntity } from '../../src/domain/entities.js';
import { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { TicketLink, TicketLinkType } from '@fleex/shared';

describe('SessionGroupingService', () => {
  const service = new SessionGroupingService();

  function makeSession(
    id: string,
    org: string | null,
    repo: string | null,
    branch: string | null,
    cwd?: string,
  ): SessionEntity {
    return new SessionEntity(
      id, `fleex_shell_${id}`, 'shell', 'running',
      cwd ?? `/projects/${org}/${repo}`, new Date(), null,
      org, repo, branch, null,
    );
  }

  function makeRepoLink(orgRepo: string): TicketLink {
    return { id: `lk-${orgRepo}`, type: 'repository' as TicketLinkType, ref: orgRepo, label: orgRepo, url: null };
  }

  /**
   * Build a SessionGroupingService wired with a resolver that treats `cwd`
   * as inside `workspaces/<ticketId>/...` and a ticket store that returns
   * the supplied ticket by id.
   */
  function buildServiceFor(ticket: TicketEntity, workspaceTicketId: string) {
    const resolver = new RepoPathResolver('/base');
    vi.spyOn(resolver, 'workspacesRoot').mockReturnValue('/base/workspaces');
    vi.spyOn(resolver, 'resolveManifest').mockImplementation((cwd: string) =>
      cwd.startsWith(`/base/workspaces/${workspaceTicketId}`) ? { ticketId: workspaceTicketId } : null,
    );
    const ticketStore = {
      getTicketById: vi.fn(async (id: string) => (id === ticket.id ? ticket : null)),
    } as unknown as TicketStorePort;
    return new SessionGroupingService(resolver, ticketStore);
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

  it('should group workspace session for a zero-repo ticket under _unassigned', async () => {
    const ticketId = 'tkt-unassigned';
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId: 'b1',
      displayId: 1,
      title: 'retro 21 mai 2026 - preparation',
      links: [],
    });
    const svc = buildServiceFor(ticket, ticketId);

    const session = makeSession('s1', null, null, null, `/base/workspaces/${ticketId}`);
    const groups = await svc.groupSessions([session]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.repositoryOrg).toBe('_unassigned');
    expect(groups[0]!.repositoryName).toBe('_unassigned');
    expect(groups[0]!.worktrees[0]!.branch).toBe('retro 21 mai 2026 - preparation');
  });

  it('should group workspace session for a single-repo ticket under that repo', async () => {
    const ticketId = 'tkt-mono';
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId: 'b1',
      displayId: 2,
      title: 'fix bug',
      links: [makeRepoLink('org/repo1')],
    });
    const svc = buildServiceFor(ticket, ticketId);

    const session = makeSession('s1', null, null, null, `/base/workspaces/${ticketId}`);
    const groups = await svc.groupSessions([session]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.repositoryOrg).toBe('org');
    expect(groups[0]!.repositoryName).toBe('repo1');
  });

  it('should group workspace session for a 2+ repo ticket under _multi-repo', async () => {
    const ticketId = 'tkt-multi';
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId: 'b1',
      displayId: 3,
      title: 'cross-repo refactor',
      links: [makeRepoLink('org/repo1'), makeRepoLink('org/repo2')],
    });
    const svc = buildServiceFor(ticket, ticketId);

    const session = makeSession('s1', null, null, null, `/base/workspaces/${ticketId}`);
    const groups = await svc.groupSessions([session]);

    expect(groups).toHaveLength(1);
    expect(groups[0]!.repositoryOrg).toBe('_multi-repo');
    expect(groups[0]!.repositoryName).toBe('_multi-repo');
  });
});

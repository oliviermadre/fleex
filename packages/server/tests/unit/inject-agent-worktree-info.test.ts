import { describe, it, expect, vi } from 'vitest';

import type { SessionGroup, Session } from '@fleex/shared';

import { GetSessionGroupsUseCase } from '../../src/application/use-cases/get-session-groups.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { SessionGroupingService } from '../../src/domain/services/session-grouping.js';

import type { PersonaStorePort } from '../../src/application/ports/persona-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';

/**
 * Regression test for the sidebar bug where Manual Flow tickets (worktrees with
 * live tmux sessions, matched to a ticket by branch label/title rather than a
 * pre-set ticketId) ended up with `ticketId === undefined`. That broke the
 * sidebar row's favorite star, priority color, and selection highlight, which all
 * key off `worktree.ticketId`.
 */
describe('GetSessionGroupsUseCase.injectAgentWorktreeInfo', () => {
  function buildUseCase(ticket: TicketEntity): GetSessionGroupsUseCase {
    const ticketStore = {
      getAllTickets: vi.fn(async () => [ticket]),
      getTicketById: vi.fn(async (id: string) => (id === ticket.id ? ticket : null)),
    } as unknown as TicketStorePort;
    const personaStore = {
      getAll: vi.fn(async () => []),
    } as unknown as PersonaStorePort;
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

    return new GetSessionGroupsUseCase(
      {} as never, // sessionStore — unused by injectAgentWorktreeInfo
      {} as never, // tmux
      new SessionGroupingService(),
      logger as never,
      undefined, // enrichClaudeActivity
      undefined, // discoverSessions
      ticketStore,
      personaStore,
      undefined, // agentEventStore
    );
  }

  function makeSession(id: string, branch: string): Session {
    return {
      id,
      tmuxName: `fleex_shell_${id}`,
      type: 'shell',
      status: 'running',
      cwd: `/projects/org/repo`,
      createdAt: new Date(0).toISOString(),
      lastAttachedAt: null,
      repositoryOrg: 'org',
      repositoryName: 'repo',
      worktreeBranch: branch,
      gitRemote: null,
      displayName: branch,
    };
  }

  it('stamps ticketId on a session-backed worktree matched by branch label', async () => {
    const ticket = TicketEntity.create({
      id: 'tkt-manual',
      boardId: 'b1',
      displayId: 236,
      title: 'Fix: Refresh de la vue workflow dans ticket detail',
      status: 'doing',
    });

    // A Manual Flow worktree: has a live session, matches the ticket by branch
    // (== ticket.title) but carries NO pre-set ticketId.
    const groups: SessionGroup[] = [
      {
        repositoryOrg: 'org',
        repositoryName: 'repo',
        worktrees: [
          {
            branch: ticket.title,
            path: '/projects/org/repo',
            sessions: [makeSession('s1', ticket.title)],
          },
        ],
      },
    ];

    const useCase = buildUseCase(ticket);
    await (
      useCase as unknown as {
        injectAgentWorktreeInfo: (g: SessionGroup[]) => Promise<void>;
      }
    ).injectAgentWorktreeInfo(groups);

    const wt = groups[0]!.worktrees[0]!;
    expect(wt.agentWorktree).toBeDefined();
    expect(wt.agentWorktree!.ticketId).toBe('tkt-manual');
    // The fix: ticketId is now stamped onto the worktree itself, not just agentWorktree.
    expect(wt.ticketId).toBe('tkt-manual');
  });
});

import { describe, it, expect } from 'vitest';
import type { Session, SessionGroup } from '@fleex/shared';
import { sessionsForTicket } from './shellSessions';

function session(over: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    tmuxName: `tmux-${over.id}`,
    type: 'shell',
    status: 'running',
    cwd: '/w/repo',
    createdAt: '2026-01-01T00:00:00.000Z',
    repositoryOrg: null,
    repositoryName: null,
    worktreeBranch: null,
    gitRemote: null,
    displayName: over.id,
    ...over,
  } as Session;
}

function group(worktrees: SessionGroup['worktrees']): SessionGroup {
  return { repositoryOrg: 'org', repositoryName: 'repo', worktrees };
}

describe('sessionsForTicket', () => {
  it('returns the sessions of worktrees bound to the ticket', () => {
    const groups: SessionGroup[] = [
      group([
        { branch: 'main', path: '/w/a', ticketId: 't1', sessions: [session({ id: 's1' })] },
        { branch: 'main', path: '/w/b', ticketId: 't2', sessions: [session({ id: 's2' })] },
      ]),
    ];
    expect(sessionsForTicket(groups, 't1').map((s) => s.id)).toEqual(['s1']);
  });

  it('matches the ticket via agentWorktree when the worktree has no direct ticketId', () => {
    const groups: SessionGroup[] = [
      group([
        {
          branch: 'main',
          path: '/w/a',
          sessions: [session({ id: 's1' })],
          agentWorktree: { ticketId: 't1', ticketDisplayId: 1, ticketTitle: 'x', status: 'doing' } as never,
        },
      ]),
    ];
    expect(sessionsForTicket(groups, 't1').map((s) => s.id)).toEqual(['s1']);
  });

  it('flattens sessions across every matching worktree, oldest first', () => {
    const groups: SessionGroup[] = [
      group([
        {
          branch: 'main',
          path: '/w/a',
          ticketId: 't1',
          sessions: [
            session({ id: 'newer', createdAt: '2026-01-02T00:00:00.000Z' }),
            session({ id: 'older', createdAt: '2026-01-01T00:00:00.000Z' }),
          ],
        },
      ]),
    ];
    expect(sessionsForTicket(groups, 't1').map((s) => s.id)).toEqual(['older', 'newer']);
  });

  it('returns nothing for a null ticket id', () => {
    const groups: SessionGroup[] = [
      group([{ branch: 'main', path: '/w/a', ticketId: 't1', sessions: [session({ id: 's1' })] }]),
    ];
    expect(sessionsForTicket(groups, null)).toEqual([]);
  });
});

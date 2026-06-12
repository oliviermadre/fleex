import { describe, it, expect } from 'vitest';
import type { Session, SessionGroup, DashboardPullRequest } from '@fleex/shared';
import { findSessionsForTicketId, findSessionsForPR } from './dashboard-helpers';

function session(opts: Partial<Session>): Session {
  return {
    id: 'id',
    tmuxName: 'fleex_shell_main',
    status: 'running',
    ...opts,
  } as Session;
}

const main = session({ id: 'main-1', tmuxName: 'fleex_shell_org_repo_main' });
const sidebar = session({
  id: 'side-1',
  tmuxName: 'fleex_sidebar_244_main-1_abcde',
  parentSessionId: 'main-1',
});

describe('findSessionsForTicketId', () => {
  const groups = [
    {
      repositoryOrg: 'org',
      repositoryName: 'repo',
      worktrees: [{ branch: 'main', path: '/wt', ticketId: 't1', sessions: [main, sidebar] }],
    },
  ] as unknown as SessionGroup[];

  it('returns running sessions for the ticket', () => {
    expect(findSessionsForTicketId('t1', groups)).toEqual([main]);
  });

  it('excludes sidebar terminals (fleex_sidebar_*)', () => {
    const ids = findSessionsForTicketId('t1', groups).map((s) => s.id);
    expect(ids).not.toContain('side-1');
  });
});

describe('findSessionsForPR', () => {
  const pr = { headRefName: 'feat', org: 'org', name: 'repo' } as DashboardPullRequest;
  const prMain = session({
    id: 'pr-main',
    tmuxName: 'fleex_shell_org_repo_feat',
    worktreeBranch: 'feat',
    repositoryOrg: 'org',
    repositoryName: 'repo',
  });
  const prSidebar = session({
    id: 'pr-side',
    tmuxName: 'fleex_sidebar_244_pr-main_abcde',
    worktreeBranch: 'feat',
    repositoryOrg: 'org',
    repositoryName: 'repo',
    parentSessionId: 'pr-main',
  });

  it('matches running sessions on branch + repo, excluding sidebar terminals', () => {
    expect(findSessionsForPR(pr, [prMain, prSidebar])).toEqual([prMain]);
  });
});

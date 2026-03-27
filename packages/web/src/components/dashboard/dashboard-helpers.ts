import type { Session, Ticket, TicketLink, DashboardPullRequest, DashboardWorktree } from '@fleex/shared';

/**
 * Find all running sessions associated with a ticket via session or worktree links.
 * Pattern from KanbanBoard.tsx:26-58
 */
export function findSessionsForTicket(
  ticket: Ticket,
  sessions: Session[],
): Session[] {
  const matched: Session[] = [];

  // Check session links
  for (const link of ticket.links) {
    if (link.type === 'session') {
      const session = sessions.find((s) => s.id === link.ref && s.status === 'running');
      if (session) matched.push(session);
    }
  }

  // Check worktree link → match sessions by org/name + branch or absolute path
  const wtLink = ticket.links.find((l: TicketLink) => l.type === 'worktree');
  if (wtLink) {
    const ref = wtLink.ref;

    if (ref.startsWith('/')) {
      // Absolute path: match sessions by cwd
      for (const s of sessions) {
        if (
          s.status === 'running' &&
          s.cwd === ref &&
          !matched.some((m) => m.id === s.id)
        ) {
          matched.push(s);
        }
      }
    } else {
      const colonIdx = ref.indexOf(':');
      if (colonIdx > 0) {
        const repoKey = ref.substring(0, colonIdx);
        const branch = ref.substring(colonIdx + 1);
        const [org, name] = repoKey.split('/');
        for (const s of sessions) {
          if (
            s.status === 'running' &&
            s.repositoryOrg === org &&
            s.repositoryName === name &&
            s.worktreeBranch === branch &&
            !matched.some((m) => m.id === s.id)
          ) {
            matched.push(s);
          }
        }
      }
    }
  }

  return matched;
}

/**
 * Find all running sessions matching a PR by branch + repo.
 * Pattern from PullRequestsSection.tsx:59
 */
export function findSessionsForPR(
  pr: DashboardPullRequest,
  sessions: Session[],
): Session[] {
  return sessions.filter(
    (s) =>
      s.status === 'running' &&
      s.worktreeBranch === pr.headRefName &&
      s.repositoryOrg === pr.org &&
      s.repositoryName === pr.name,
  );
}

/**
 * Check if any active worktree matches a PR's head branch.
 */
export function hasLocalWorktreeForPR(
  pr: DashboardPullRequest,
  worktrees: DashboardWorktree[],
): boolean {
  return worktrees.some((wt) => wt.branch === pr.headRefName && wt.org === pr.org && wt.name === pr.name);
}

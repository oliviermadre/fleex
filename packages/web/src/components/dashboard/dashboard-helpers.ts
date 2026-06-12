import type { Session, SessionGroup, DashboardPullRequest, DashboardWorktree } from '@fleex/shared';
import { isSidebarSession } from '@fleex/shared';

/**
 * Running sessions for a ticket, via the backend's authoritative worktree
 * grouping (WorktreeSessionGroup.ticketId). Use this instead of matching
 * against ticket.links — links can be missing or stale, the backend grouping
 * is the source of truth and is what UnifiedWorktreePanel consumes.
 * Sidebar terminals are excluded — they live in their parent's right panel.
 */
export function findSessionsForTicketId(
  ticketId: string,
  sessionGroups: SessionGroup[],
): Session[] {
  const out: Session[] = [];
  for (const group of sessionGroups) {
    for (const wt of group.worktrees) {
      if (wt.ticketId !== ticketId && wt.agentWorktree?.ticketId !== ticketId) continue;
      for (const s of wt.sessions) {
        if (s.status === 'running' && !isSidebarSession(s) && !out.some((x) => x.id === s.id)) {
          out.push(s);
        }
      }
    }
  }
  return out;
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
      !isSidebarSession(s) &&
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

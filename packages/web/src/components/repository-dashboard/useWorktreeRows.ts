import { useMemo } from 'react';
import type { RepositoryDashboardData } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useSessionStore } from '../../stores/sessionStore';
import { buildWorktreeRows, type WorktreeRow } from './overview-helpers';

/**
 * Compute the active/stale worktree rows for a repo. Shared by the Overview
 * panel (limited preview) and the dedicated Worktrees tab (full listing) so
 * both derive rows the same way.
 */
export function useWorktreeRows(
  org: string,
  name: string,
  data: RepositoryDashboardData,
): { active: WorktreeRow[]; orphaned: WorktreeRow[] } {
  const tickets = useTicketStore((s) => s.tickets);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const sessionGroup = sessionGroups.find((g) => g.repositoryOrg === org && g.repositoryName === name);
  const pulls = useMemo(() => [...data.openPullRequests, ...data.recentlyMergedPullRequests], [data]);
  return useMemo(
    () => buildWorktreeRows(data.worktrees, data.worktreeTickets, data.diffStats, sessionGroup, tickets, pulls),
    [data, sessionGroup, tickets, pulls],
  );
}

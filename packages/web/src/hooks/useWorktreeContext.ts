import { useMemo, useEffect } from 'react';
import type { Session, WorktreeSessionGroup, Ticket, AgentExecution, TicketLink } from '@fleex/shared';
import { useSessionStore } from '../stores/sessionStore';
import { useTicketStore } from '../stores/ticketStore';
import { useAgentEventStore } from '../stores/agentEventStore';

export type WorktreeEntry =
  | { kind: 'session'; sessionId: string }
  | { kind: 'agent'; ticketId: string };

export interface WorktreeContext {
  worktree: WorktreeSessionGroup | null;
  repoOrg: string;
  repoName: string;
  groupId: string;
  sessions: Session[];
  executions: AgentExecution[];
  ticket: Ticket | null;
}

const EMPTY_EXECUTIONS: AgentExecution[] = [];

/**
 * Resolves the worktree context from either a session ID or a ticket ID.
 * Returns everything the unified panel needs: worktree data, sessions, executions, ticket info.
 */
export function useWorktreeContext(entry: WorktreeEntry): WorktreeContext {
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const sessions = useSessionStore((s) => s.sessions);
  const tickets = useTicketStore((s) => s.tickets);
  const executionsByTicket = useAgentEventStore((s) => s.executionsByTicket);
  const loadExecutions = useAgentEventStore((s) => s.loadExecutionsForTicket);

  // Stable primitives for memoization (avoids re-running on object identity changes)
  const entryKind = entry.kind;
  const entryId = entry.kind === 'session' ? entry.sessionId : entry.ticketId;

  const resolved = useMemo(() => {
    if (entryKind === 'agent') {
      // Find worktree by ticketId
      for (const group of sessionGroups) {
        for (const wt of group.worktrees) {
          if (wt.agentWorktree?.ticketId === entryId) {
            const gId = `${group.repositoryOrg}/${group.repositoryName}:${wt.branch}`;
            const ticket = tickets.find((t) => t.id === entryId) ?? null;
            return {
              worktree: wt,
              repoOrg: group.repositoryOrg,
              repoName: group.repositoryName,
              groupId: gId,
              sessions: wt.sessions,
              ticketId: entryId,
              ticket,
            };
          }
        }
      }
      // Worktree not found — still return ticket if available
      const ticket = tickets.find((t) => t.id === entryId) ?? null;
      return { worktree: null, repoOrg: '', repoName: '', groupId: '', sessions: [] as Session[], ticketId: entryId, ticket };
    }

    // Find worktree by sessionId
    const session = sessions.find((s) => s.id === entryId);
    if (!session) {
      return { worktree: null, repoOrg: '', repoName: '', groupId: '', sessions: [] as Session[], ticketId: null, ticket: null };
    }

    const targetOrg = session.repositoryOrg ?? '_ungrouped';
    const targetName = session.repositoryName ?? '_ungrouped';
    const targetBranch = session.worktreeBranch ?? '_default';
    const isSystem = !session.repositoryOrg || !session.repositoryName || !session.worktreeBranch;
    const gId = isSystem ? '_system' : `${targetOrg}/${targetName}:${targetBranch}`;

    for (const group of sessionGroups) {
      if (group.repositoryOrg === targetOrg && group.repositoryName === targetName) {
        for (const wt of group.worktrees) {
          if (wt.branch === targetBranch) {
            // Try agent worktree ticket first, then fall back to worktree link
            const worktreeRef = `${targetOrg}/${targetName}:${wt.branch}`;
            let tId = wt.agentWorktree?.ticketId ?? null;
            let ticket: Ticket | null = tId ? (tickets.find((t) => t.id === tId) ?? null) : null;
            if (!ticket) {
              ticket = tickets.find((t) => t.links.some((l: TicketLink) => l.type === 'worktree' && l.ref === worktreeRef)) ?? null;
              tId = ticket?.id ?? null;
            }
            return {
              worktree: wt,
              repoOrg: targetOrg,
              repoName: targetName,
              groupId: gId,
              sessions: wt.sessions,
              ticketId: tId,
              ticket,
            };
          }
        }
      }
    }

    return { worktree: null, repoOrg: targetOrg, repoName: targetName, groupId: gId, sessions: [] as Session[], ticketId: null, ticket: null };
  }, [entryKind, entryId, sessionGroups, sessions, tickets]);

  // Load executions if this worktree has a linked ticket
  const ticketId = resolved.ticketId;
  useEffect(() => {
    if (ticketId) loadExecutions(ticketId);
  }, [ticketId, loadExecutions]);

  const executions = ticketId ? (executionsByTicket[ticketId] ?? EMPTY_EXECUTIONS) : EMPTY_EXECUTIONS;

  return {
    worktree: resolved.worktree,
    repoOrg: resolved.repoOrg,
    repoName: resolved.repoName,
    groupId: resolved.groupId,
    sessions: resolved.sessions,
    executions,
    ticket: resolved.ticket,
  };
}

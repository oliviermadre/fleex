import { useMemo, useEffect } from 'react';
import type { Session, WorktreeSessionGroup, Ticket, AgentExecution } from '@fleex/shared';
import { useSessionStore } from '../stores/sessionStore';
import { useTicketStore } from '../stores/ticketStore';
import { useAgentEventStore } from '../stores/agentEventStore';

export type WorktreeEntry =
  | { kind: 'session'; sessionId: string }
  | { kind: 'ticket'; ticketId: string }
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
    if (entryKind === 'agent' || entryKind === 'ticket') {
      // Find worktree by ticketId
      for (const group of sessionGroups) {
        for (const wt of group.worktrees) {
          if (wt.ticketId === entryId || wt.agentWorktree?.ticketId === entryId) {
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
      const ticket = tickets.find((t) => t.id === entryId) ?? null;
      return { worktree: null, repoOrg: '', repoName: '', groupId: '', sessions: [] as Session[], ticketId: entryId, ticket };
    }

    // Find worktree that actually contains this session (the backend's grouping is authoritative)
    for (const group of sessionGroups) {
      for (const wt of group.worktrees) {
        if (wt.sessions.some((s: Session) => s.id === entryId)) {
          const gId = (group.repositoryOrg === '_ungrouped')
            ? '_system'
            : `${group.repositoryOrg}/${group.repositoryName}:${wt.branch}`;
          const tId = wt.ticketId ?? null;
          const ticket = tId ? (tickets.find((t) => t.id === tId) ?? null) : null;
          return {
            worktree: wt,
            repoOrg: group.repositoryOrg,
            repoName: group.repositoryName,
            groupId: gId,
            sessions: wt.sessions,
            ticketId: tId,
            ticket,
          };
        }
      }
    }

    return { worktree: null, repoOrg: '', repoName: '', groupId: '', sessions: [] as Session[], ticketId: null, ticket: null };
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

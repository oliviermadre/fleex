import type {
  Worktree,
  DiffStats,
  Ticket,
  PullRequest,
  SessionGroup,
  WorktreeTicketRef,
} from '@fleex/shared';

import { deriveWorktreeVerdict, type WorktreeVerdict } from '../../lib/worktreeVerdict';

export interface WorktreeRow {
  worktree: Worktree;
  diff?: DiffStats;
  ticket: WorktreeTicketRef | null;
  pr: PullRequest | null;
  verdict: WorktreeVerdict;
}

const CLOSED = new Set(['done', 'cancelled']);

function toRef(worktreePath: string, ticket: Ticket): WorktreeTicketRef {
  return {
    worktreePath,
    id: ticket.id,
    displayId: ticket.displayId,
    title: ticket.title,
    status: ticket.status,
    type: ticket.type ?? null,
    priority: ticket.priority,
    boardId: ticket.boardId,
  };
}

export function buildWorktreeRows(
  worktrees: Worktree[],
  worktreeTickets: WorktreeTicketRef[],
  diffStats: Record<string, DiffStats>,
  sessionGroup: SessionGroup | undefined,
  tickets: Ticket[],
  pulls: PullRequest[],
): { active: WorktreeRow[]; orphaned: WorktreeRow[] } {
  const active: WorktreeRow[] = [];
  const orphaned: WorktreeRow[] = [];
  const refByPath = new Map(worktreeTickets.map((r) => [r.worktreePath, r]));

  for (const worktree of worktrees) {
    if (worktree.isBare || worktree.isMain) continue;

    // Server-resolved ticket (authoritative: reads .fleex.json, survives closed
    // sessions and archived tickets). Fall back to the live session group / a
    // worktree link only when the server could not resolve one.
    const serverRef = refByPath.get(worktree.path);
    const grouped = sessionGroup?.worktrees.find((w) => w.path === worktree.path);
    const clientTicket = serverRef
      ? null
      : ((grouped?.ticketId ? tickets.find((t) => t.id === grouped.ticketId) : undefined) ??
        tickets.find((t) =>
          t.links.some(
            (l) =>
              l.type === 'worktree' &&
              (l.ref === worktree.path || l.ref.endsWith(`/${worktree.branch}`)),
          ),
        ) ??
        null);
    const ticket = serverRef ?? (clientTicket ? toRef(worktree.path, clientTicket) : null);

    const pr = pulls.find((p) => p.headRefName === worktree.branch) ?? null;
    const diff = diffStats[worktree.branch];

    const verdict = deriveWorktreeVerdict({
      commitsAhead: diff?.commitsAhead ?? 0,
      commitsBehind: diff?.commitsBehind ?? 0,
      ...(pr ? { prState: pr.state } : {}),
      ...(ticket ? { ticketStatus: ticket.status } : {}),
      ticketMissing: !ticket,
    });

    const row: WorktreeRow = { worktree, ticket, pr, verdict, ...(diff ? { diff } : {}) };
    if (!ticket || CLOSED.has(ticket.status)) orphaned.push(row);
    else active.push(row);
  }

  return { active, orphaned };
}

import type { Worktree, DiffStats, Ticket, PullRequest, SessionGroup } from '@fleex/shared';
import { deriveWorktreeVerdict, type WorktreeVerdict } from '../../lib/worktreeVerdict';

export interface WorktreeRow {
  worktree: Worktree;
  diff?: DiffStats;
  ticket: Ticket | null;
  pr: PullRequest | null;
  verdict: WorktreeVerdict;
}

const CLOSED = new Set(['done', 'cancelled']);

export function buildWorktreeRows(
  worktrees: Worktree[],
  diffStats: Record<string, DiffStats>,
  sessionGroup: SessionGroup | undefined,
  tickets: Ticket[],
  pulls: PullRequest[],
): { active: WorktreeRow[]; orphaned: WorktreeRow[] } {
  const active: WorktreeRow[] = [];
  const orphaned: WorktreeRow[] = [];

  for (const worktree of worktrees) {
    if (worktree.isBare || worktree.isMain) continue;

    const grouped = sessionGroup?.worktrees.find((w) => w.path === worktree.path);
    const ticket =
      (grouped?.ticketId ? tickets.find((t) => t.id === grouped.ticketId) : undefined) ??
      tickets.find((t) => t.links.some((l) => l.type === 'worktree' && (l.ref === worktree.path || l.ref.endsWith(`/${worktree.branch}`)))) ??
      null;
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

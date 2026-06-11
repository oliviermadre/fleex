import { TICKET_STATUS } from '@fleex/shared';
import type { WorktreeSessionGroup } from '@fleex/shared';

/** Sidebar flow buckets, in their on-screen order (System is separate, first). */
export type SessionFlow = 'manual' | 'agentic' | 'done';

/** Flow sections in the exact order the sidebar renders them. Keyboard
 *  navigation iterates this so it matches the visual order. */
export const SESSION_FLOW_ORDER: readonly SessionFlow[] = ['manual', 'agentic', 'done'];

export function isActiveTicketStatus(status: string | undefined): boolean {
  return status === TICKET_STATUS.DOING || status === TICKET_STATUS.REVIEWING;
}

/**
 * Classify a worktree into its sidebar flow bucket — the single source of truth
 * shared by the sidebar render (`partitionByFlow`) and keyboard navigation
 * (`orderedWorktrees`), so the two never drift out of order.
 *
 * Keyed on `agentWorktree` (present only for ticket-driven worktrees):
 * - manual:  active ticket (doing/reviewing) with ≥1 live tmux session
 * - agentic: active ticket with no live tmux session (phantom worktree)
 * - done:    non-active ticket that still owns a live tmux session
 * Returns null when the worktree isn't shown in any flow (no agentWorktree, or a
 * non-active ticket with no sessions — orphan shells live under System).
 */
export function worktreeFlow(wt: WorktreeSessionGroup): SessionFlow | null {
  if (wt.agentWorktree == null) return null;
  if (isActiveTicketStatus(wt.agentWorktree.ticketStatus)) {
    return wt.sessions.length > 0 ? 'manual' : 'agentic';
  }
  return wt.sessions.length > 0 ? 'done' : null;
}

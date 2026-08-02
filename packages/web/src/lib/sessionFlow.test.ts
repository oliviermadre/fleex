import { describe, it, expect } from 'vitest';

import { TICKET_STATUS } from '@fleex/shared';
import type { WorktreeSessionGroup } from '@fleex/shared';

import { worktreeFlow, isActiveTicketStatus } from './sessionFlow';

function wt(opts: { status?: string; sessions?: number; agent?: boolean }): WorktreeSessionGroup {
  const hasAgent = opts.agent !== false;
  return {
    sessions: Array.from({ length: opts.sessions ?? 0 }, (_, i) => ({ id: `s${i}` })),
    agentWorktree: hasAgent ? { ticketStatus: opts.status ?? TICKET_STATUS.DOING } : null,
  } as unknown as WorktreeSessionGroup;
}

describe('worktreeFlow', () => {
  it('classifies an active ticket with live sessions as manual', () => {
    expect(worktreeFlow(wt({ status: TICKET_STATUS.DOING, sessions: 2 }))).toBe('manual');
    expect(worktreeFlow(wt({ status: TICKET_STATUS.REVIEWING, sessions: 1 }))).toBe('manual');
  });

  it('classifies an active ticket with no sessions as agentic', () => {
    expect(worktreeFlow(wt({ status: TICKET_STATUS.DOING, sessions: 0 }))).toBe('agentic');
  });

  it('classifies a non-active ticket that still owns sessions as done', () => {
    expect(worktreeFlow(wt({ status: TICKET_STATUS.DONE, sessions: 1 }))).toBe('done');
    expect(worktreeFlow(wt({ status: TICKET_STATUS.CANCELLED, sessions: 3 }))).toBe('done');
  });

  it('returns null when the worktree is not shown in any flow', () => {
    expect(worktreeFlow(wt({ status: TICKET_STATUS.DONE, sessions: 0 }))).toBeNull(); // done, no sessions
    expect(worktreeFlow(wt({ agent: false, sessions: 2 }))).toBeNull(); // no agentWorktree
  });
});

describe('isActiveTicketStatus', () => {
  it('is true only for doing/reviewing', () => {
    expect(isActiveTicketStatus(TICKET_STATUS.DOING)).toBe(true);
    expect(isActiveTicketStatus(TICKET_STATUS.REVIEWING)).toBe(true);
    expect(isActiveTicketStatus(TICKET_STATUS.DONE)).toBe(false);
    expect(isActiveTicketStatus(TICKET_STATUS.TODO)).toBe(false);
    expect(isActiveTicketStatus(undefined)).toBe(false);
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import type { Ticket, TicketUnreadCounts } from '@fleex/shared';
import { ListFocusRow } from './ListFocusRow';

afterEach(cleanup);

/**
 * Cockpit row layout (#400, review feedback):
 * - the ticket id must be readable as the FIRST column (scan anchor),
 * - badges use SVG icons, never emojis (professional look),
 * - the status chip is redundant inside a status group and only appears for
 *   rows of the virtual "En attente" group whose statuses are heterogeneous.
 */

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    boardId: 'b1',
    displayId: 412,
    title: 'Fix auth loop',
    description: '',
    status: 'doing',
    priority: 'none',
    type: null,
    position: 0,
    tags: [],
    links: [],
    blocked: false,
    favorite: false,
    dueDate: null,
    assignee: null,
    agentClaimedAt: null,
    githubMetadata: null,
    archivedAt: null,
    firstDoingAt: null,
    statusChangedAt: '2026-07-01T00:00:00.000Z',
    conversationMode: 'plan',
    modelOverride: null,
    effortOverride: null,
    fastMode: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  } as Ticket;
}

const unread: TicketUnreadCounts = {
  ticketId: 't1',
  totalComments: 3,
  totalDeliverables: 1,
  unreadComments: 1,
  unreadDeliverables: 0,
};

function renderRow(props: Partial<Parameters<typeof ListFocusRow>[0]> = {}) {
  return render(
    <ListFocusRow
      ticket={makeTicket()}
      activity="idle"
      unread={unread}
      prStates={{}}
      selected={false}
      showStatus={false}
      onOpen={() => {}}
      onStatusChange={() => {}}
      {...props}
    />,
  );
}

describe('ListFocusRow', () => {
  it('shows the ticket id as the first column (scan anchor)', () => {
    const { container } = renderRow();
    const row = container.querySelector('[role="button"]');
    expect(row?.firstElementChild?.textContent).toBe('#412');
  });

  it('renders SVG badges, never emojis (💬/📦 replaced per review)', () => {
    // WHY: emojis read as unpolished; badges must use the same SVG glyphs as
    // the kanban card footer so counts look identical across surfaces.
    const { container } = renderRow();
    expect(container.textContent).not.toMatch(/[💬📦⏳]/u);
    const badgeIcons = container.querySelectorAll('button svg');
    expect(badgeIcons.length).toBeGreaterThanOrEqual(2);
    expect(container.textContent).toContain('3'); // comment count still visible
  });

  it('hides the status chip inside a status group (grouping already says it)', () => {
    const { container } = renderRow({ showStatus: false });
    expect(container.textContent).not.toContain('Doing');
  });

  it('shows the status chip only for waiting-group rows (heterogeneous statuses)', () => {
    const { container } = renderRow({ showStatus: true, activity: 'waiting' });
    expect(container.textContent).toContain('Doing');
  });

  it('surfaces "waiting" in the activity cell now that the dedicated column is gone', () => {
    const { container } = renderRow({ activity: 'waiting', detail: 'mention non résolue' });
    expect(container.textContent).toContain('Waiting');
    expect(container.textContent).not.toContain('Idle');
    expect(container.querySelector('[title="mention non résolue"]')).not.toBeNull();
  });
});

import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import type { Board, Ticket, TicketUnreadCounts } from '@fleex/shared';
import { TICKET_TYPE_LABELS } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { ListFocusRow } from './ListFocusRow';

// floating-ui popovers (priority/type pickers) need observers jsdom lacks.
beforeAll(() => {
  class Obs {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Obs);
  vi.stubGlobal('IntersectionObserver', Obs);
});

const originalUpdateTicket = useTicketStore.getState().updateTicket;
afterEach(() => {
  cleanup();
  useTicketStore.setState({ updateTicket: originalUpdateTicket });
});

/**
 * Cockpit row layout (#400, pass 4):
 * - column order is id · pictos · type · title · activity · board · PR · badges
 *   (remark 2: board sits between the title and the PR column; remark 5: the
 *   activity badge column sits right after the title, before the board),
 * - the activity column always says something: Waiting / Running / idle since,
 * - the status chip is gone from rows — the group header carries the status.
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

const board: Board = {
  id: 'b1',
  name: 'Fleex Core',
  emoji: '🧭',
} as Board;

function renderRow(props: Partial<Parameters<typeof ListFocusRow>[0]> = {}) {
  return render(
    <ListFocusRow
      ticket={makeTicket()}
      activity="idle"
      lastActivityAt={null}
      unread={unread}
      prStates={{}}
      selected={false}
      onOpen={() => {}}
      onToggleFavorite={() => {}}
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

  it('orders columns id · pictos · type · title · activity · board · PR (pass 4, remarks 2+5)', () => {
    // WHY: NaS asked for the activity badge "juste après le titre, avant le
    // board" and the board "entre le titre du ticket et la colonne de PR".
    const { container } = renderRow({
      ticket: makeTicket({ type: 'fix', priority: 'high' }),
      board,
      activity: 'running',
    });
    const cols = container.querySelector('[role="button"]')!.children;
    expect(cols[1]?.querySelector('[title^="Priority"]')).not.toBeNull();
    expect(cols[2]?.textContent).toContain(TICKET_TYPE_LABELS['fix']);
    expect(cols[3]?.textContent).toContain('Fix auth loop');
    expect(cols[4]?.textContent).toContain('Running'); // activity column
    expect(cols[5]?.textContent).toContain('Fleex Core'); // board after activity
    expect(cols[6]?.className).toContain('w-[92px]'); // then PR
  });

  it('never renders a status chip on the row (grouping header already says it)', () => {
    const { container } = renderRow({ activity: 'waiting' });
    expect(container.textContent).not.toContain('Doing');
  });

  it('shows the Waiting badge in the activity column (pass 4, remark 3: badge, not grouping)', () => {
    const { container } = renderRow({ activity: 'waiting', detail: 'mention non résolue' });
    expect(container.textContent).toContain('Waiting');
    expect(container.querySelector('[title="mention non résolue"]')).not.toBeNull();
  });

  it('shows "idle since {{age}}" for idle rows with a past SDK session (pass 4, remark 5)', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600 * 1000).toISOString();
    const { container } = renderRow({ activity: 'idle', lastActivityAt: twoHoursAgo });
    expect(container.textContent).toContain('idle since 2h');
  });

  it('shows plain "idle" when the ticket never had an SDK session (pass 4, remark 5)', () => {
    const { container } = renderRow({ activity: 'idle', lastActivityAt: null });
    expect(container.textContent).toContain('idle');
    expect(container.textContent).not.toContain('idle since');
  });

  it('shows priority + favorite pictos and type + due-date badges (review remark 3)', () => {
    const { container } = renderRow({
      ticket: makeTicket({ priority: 'high', favorite: true, type: 'fix', dueDate: '2099-01-01' }),
    });
    expect(container.querySelector('[title^="Priority: High"]')).not.toBeNull();
    expect(container.querySelector('[title="Remove from favorites"]')).not.toBeNull();
    expect(container.textContent).toContain(TICKET_TYPE_LABELS['fix']);
    expect(container.textContent).toMatch(/J-\d+/);
  });

  it('clicking the priority picto opens a picker that updates the ticket (pass 3, remark 5)', () => {
    const updateTicket = vi.fn();
    useTicketStore.setState({ updateTicket });
    const onOpen = vi.fn();
    const { container } = renderRow({ ticket: makeTicket({ priority: 'none' }), onOpen });
    fireEvent.click(container.querySelector('[title^="Priority"]')!);
    fireEvent.click(screen.getByText('High'));
    expect(updateTicket).toHaveBeenCalledWith('t1', { priority: 'high' });
    expect(onOpen).not.toHaveBeenCalled(); // picker never steals the row click
  });

  it('clicking the type badge opens a picker that updates the ticket (pass 3, remark 5)', () => {
    const updateTicket = vi.fn();
    useTicketStore.setState({ updateTicket });
    const onOpen = vi.fn();
    const { container } = renderRow({ ticket: makeTicket({ type: null }), onOpen });
    fireEvent.click(container.querySelector('[title="Click to change type"]')!);
    fireEvent.click(screen.getByText(TICKET_TYPE_LABELS['fix']!));
    expect(updateTicket).toHaveBeenCalledWith('t1', { type: 'fix' });
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('toggles the favorite without opening the inspector (star is a real action)', () => {
    const onOpen = vi.fn();
    const onToggleFavorite = vi.fn();
    const { container } = renderRow({
      ticket: makeTicket({ favorite: true }),
      onOpen,
      onToggleFavorite,
    });
    fireEvent.click(container.querySelector('[title="Remove from favorites"]')!);
    expect(onToggleFavorite).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('strips the org from the PR badge label but keeps it in the tooltip (review remark 5)', () => {
    // WHY: "oliviermadre/fleex#209" truncated to "oliviermadr…" in the narrow PR
    // column — the org prefix ate the useful part (repo + number).
    const { container } = renderRow({
      ticket: makeTicket({
        links: [
          {
            id: 'l1',
            type: 'github_pr',
            ref: 'oliviermadre/fleex#209',
            label: 'oliviermadre/fleex#209',
            url: 'https://github.com/oliviermadre/fleex/pull/209',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    });
    const badge = container.querySelector('a');
    expect(badge?.textContent).toBe('fleex#209');
    expect(badge?.getAttribute('title')).toContain('oliviermadre/fleex#209');
  });

  it('always shows the repo name, even when the link label is just "PR #209" (pass 3, remark 4)', () => {
    // WHY: some links are created with label "PR #209" (detect-merge) — but the
    // ref is always canonical "org/repo#number", so derive the display from it.
    const { container } = renderRow({
      ticket: makeTicket({
        links: [
          {
            id: 'l1',
            type: 'github_pr',
            ref: 'oliviermadre/fleex#209',
            label: 'PR #209',
            url: 'https://github.com/oliviermadre/fleex/pull/209',
            createdAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      }),
    });
    const badge = container.querySelector('a');
    expect(badge?.textContent).toBe('fleex#209');
  });
});

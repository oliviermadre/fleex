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
      unread={unread}
      prStates={{}}
      selected={false}
      inWaitingGroup={false}
      onOpen={() => {}}
      onStatusChange={() => {}}
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

  it('hides the status chip inside a status group (grouping already says it)', () => {
    const { container } = renderRow({ inWaitingGroup: false });
    expect(container.textContent).not.toContain('Doing');
  });

  it('shows the status chip only for waiting-group rows (heterogeneous statuses)', () => {
    const { container } = renderRow({ inWaitingGroup: true, activity: 'waiting' });
    expect(container.textContent).toContain('Doing');
  });

  it('hides the redundant "Waiting" pill inside the waiting group (pass 3, remark 2)', () => {
    // WHY: every waiting ticket is pulled into the "En attente" group (D2) —
    // repeating a Waiting badge on each of its rows says nothing new.
    const { container } = renderRow({
      activity: 'waiting',
      inWaitingGroup: true,
      detail: 'mention non résolue',
    });
    expect(container.textContent).not.toContain('Waiting');
  });

  it('still shows the waiting pill OUTSIDE the waiting group (frozen-order edge)', () => {
    // A ticket can turn waiting while the inspector's D3 freeze keeps it inside
    // its status group — there the pill is the only "blocked" signal.
    const { container } = renderRow({
      activity: 'waiting',
      inWaitingGroup: false,
      detail: 'mention non résolue',
    });
    expect(container.textContent).toContain('Waiting');
    expect(container.querySelector('[title="mention non résolue"]')).not.toBeNull();
  });

  it('drops the dedicated activity column: idle rows show no "Idle" label (review remark 3)', () => {
    // WHY: most rows are idle, so a whole column repeating "Idle" was noise.
    // Activity is now an inline pill shown only when something IS happening.
    const { container } = renderRow({ activity: 'idle' });
    expect(container.textContent).not.toContain('Idle');
  });

  it('renders the board in its own column, right after the id (review remark 3)', () => {
    const { container } = renderRow({ board });
    const row = container.querySelector('[role="button"]');
    expect(row?.children[1]?.textContent).toContain('Fleex Core');
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

  it('renders the type in a dedicated column between the priority pictos and the title (pass 3, remark 3)', () => {
    // WHY: a dedicated fixed-width column makes every title start at the same
    // x, so the eye scans types then titles vertically.
    const { container } = renderRow({ ticket: makeTicket({ type: 'fix', priority: 'high' }) });
    const cols = container.querySelector('[role="button"]')!.children;
    // 0 id · 1 board · 2 pictos (★ + priority) · 3 type · 4 main (title…)
    expect(cols[2]?.querySelector('[title^="Priority"]')).not.toBeNull();
    expect(cols[3]?.textContent).toContain(TICKET_TYPE_LABELS['fix']);
    expect(cols[4]?.textContent).toContain('Fix auth loop');
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

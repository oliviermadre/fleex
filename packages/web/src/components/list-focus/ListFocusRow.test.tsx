import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import type { Board, Ticket, TicketUnreadCounts } from '@fleex/shared';
import { TICKET_TYPE_LABELS } from '@fleex/shared';
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
      showStatus={false}
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
    expect(container.querySelector('[title="High"]')).not.toBeNull();
    expect(container.querySelector('[title="Remove from favorites"]')).not.toBeNull();
    expect(container.textContent).toContain(TICKET_TYPE_LABELS['fix']);
    expect(container.textContent).toMatch(/J-\d+/);
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
});

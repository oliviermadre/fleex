import { describe, it, expect } from 'vitest';
import type { AgentActivityState, Ticket, TicketStatus } from '@fleex/shared';
import type { ListFocusFilters } from '../../stores/listFocusStore';
import { DEFAULT_LIST_FOCUS_STATUSES } from '../../stores/listFocusStore';
import { buildListFocusGroups, groupHue, shouldRefreezeForStatusChange } from './grouping';

/**
 * Cockpit grouping (#400). Pass 4 (remark 3) REMOVED the virtual "En attente"
 * group of D2: NaS prefers a waiting badge on the row over a grouping, so
 * tickets now stay in their status group and the activity column carries the
 * waiting/running/idle signal. Waiting tickets still float to the top of their
 * group (waiting > running > idle) so blocked agents remain easy to spot.
 */

/** Minimal Ticket factory — only the fields grouping.ts actually reads matter. */
function mkTicket(partial: Partial<Ticket> & { id: string }): Ticket {
  return {
    boardId: 'board-1',
    displayId: 1,
    title: `Ticket ${partial.id}`,
    description: '',
    status: 'doing',
    priority: 'medium',
    type: 'build',
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
    statusChangedAt: '2026-01-01T00:00:00.000Z',
    conversationMode: 'plan',
    modelOverride: null,
    effortOverride: null,
    fastMode: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function filters(partial: Partial<ListFocusFilters> = {}): ListFocusFilters {
  return {
    boardIds: [],
    statuses: DEFAULT_LIST_FOCUS_STATUSES,
    favoritesOnly: false,
    types: [],
    priorities: [],
    titleQuery: '',
    ...partial,
  };
}

const keys = (groups: { key: string }[]) => groups.map((g) => g.key);
const idsOf = (groups: { key: string; tickets: Ticket[] }[], key: string) =>
  groups.find((g) => g.key === key)?.tickets.map((t) => t.id) ?? [];

describe('buildListFocusGroups', () => {
  it('keeps waiting tickets inside their status group — badge, not grouping (pass 4, remark 3)', () => {
    // WHY: NaS explicitly preferred a waiting badge on the row over a virtual
    // group; a waiting `doing` ticket must render in the Doing group.
    const tickets = [
      mkTicket({ id: 'doing-run', status: 'doing' }),
      mkTicket({ id: 'doing-wait', status: 'doing' }),
      mkTicket({ id: 'review-wait', status: 'reviewing' }),
    ];
    const activity: Record<string, AgentActivityState> = {
      'doing-run': 'running',
      'doing-wait': 'waiting',
      'review-wait': 'waiting',
    };

    const groups = buildListFocusGroups(tickets, activity, filters());

    expect(keys(groups)).toEqual(['doing', 'reviewing']); // no virtual group
    expect(idsOf(groups, 'doing')).toContain('doing-wait');
    expect(idsOf(groups, 'reviewing')).toEqual(['review-wait']);
  });

  it('floats waiting above running above idle inside a group', () => {
    // WHY: without the virtual group, the intra-group order is what keeps a
    // blocked agent visible at the top of its status section.
    const tickets = [
      mkTicket({ id: 'idle1', status: 'doing', statusChangedAt: '2026-01-05T00:00:00.000Z' }),
      mkTicket({ id: 'wait1', status: 'doing', statusChangedAt: '2026-01-01T00:00:00.000Z' }),
      mkTicket({ id: 'run1', status: 'doing', statusChangedAt: '2026-01-03T00:00:00.000Z' }),
    ];
    const activity: Record<string, AgentActivityState> = { wait1: 'waiting', run1: 'running' };

    const groups = buildListFocusGroups(tickets, activity, filters());
    expect(idsOf(groups, 'doing')).toEqual(['wait1', 'run1', 'idle1']);
  });

  it('keeps empty scoped status groups so headers stay stable', () => {
    const tickets = [mkTicket({ id: 'a', status: 'doing' })];
    const groups = buildListFocusGroups(tickets, { a: 'running' }, filters());

    expect(keys(groups)).toEqual(['doing', 'reviewing']); // both scoped, reviewing empty
    expect(idsOf(groups, 'reviewing')).toEqual([]);
  });

  it('filters by several boards at once (multi-select, empty = all)', () => {
    const tickets = [
      mkTicket({ id: 'b1', boardId: 'board-1' }),
      mkTicket({ id: 'b2', boardId: 'board-2' }),
      mkTicket({ id: 'b3', boardId: 'board-3' }),
    ];

    const two = buildListFocusGroups(tickets, {}, filters({ boardIds: ['board-1', 'board-3'] }));
    expect(idsOf(two, 'doing').sort()).toEqual(['b1', 'b3']);

    const all = buildListFocusGroups(tickets, {}, filters({ boardIds: [] }));
    expect(idsOf(all, 'doing')).toHaveLength(3);
  });

  it('filters by several types and priorities at once (multi-select, empty = all)', () => {
    const tickets = [
      mkTicket({ id: 'fix-high', type: 'fix', priority: 'high' }),
      mkTicket({ id: 'build-low', type: 'build', priority: 'low' }),
      mkTicket({ id: 'untyped', type: null, priority: 'none' }),
    ];

    const byTypes = buildListFocusGroups(tickets, {}, filters({ types: ['fix', 'build'] }));
    expect(idsOf(byTypes, 'doing').sort()).toEqual(['build-low', 'fix-high']);

    const byPriorities = buildListFocusGroups(tickets, {}, filters({ priorities: ['low', 'none'] }));
    expect(idsOf(byPriorities, 'doing').sort()).toEqual(['build-low', 'untyped']);

    const all = buildListFocusGroups(tickets, {}, filters());
    expect(idsOf(all, 'doing')).toHaveLength(3);
  });

  it('filters by title substring, case-insensitively (pass 4, remark 1)', () => {
    const tickets = [
      mkTicket({ id: 'auth', title: 'Fix Auth loop' }),
      mkTicket({ id: 'csv', title: 'Export CSV' }),
    ];

    const hit = buildListFocusGroups(tickets, {}, filters({ titleQuery: 'auth' }));
    expect(idsOf(hit, 'doing')).toEqual(['auth']);

    const blank = buildListFocusGroups(tickets, {}, filters({ titleQuery: '   ' }));
    expect(idsOf(blank, 'doing')).toHaveLength(2); // whitespace-only = no filter
  });

  it('scopes by favorites', () => {
    const tickets = [
      mkTicket({ id: 'fav', favorite: true }),
      mkTicket({ id: 'nofav', favorite: false }),
    ];
    const byFav = buildListFocusGroups(tickets, {}, filters({ favoritesOnly: true }));
    expect(idsOf(byFav, 'doing')).toEqual(['fav']);
  });

  it('renders scoped status groups in canonical column order', () => {
    const tickets = [
      mkTicket({ id: 'r', status: 'reviewing' }),
      mkTicket({ id: 'd', status: 'doing' }),
    ];
    const statuses: TicketStatus[] = ['reviewing', 'doing'];
    const groups = buildListFocusGroups(tickets, {}, filters({ statuses }));
    // Canonical TICKET_STATUSES order (doing before reviewing), not filter order.
    expect(keys(groups)).toEqual(['doing', 'reviewing']);
  });
});

describe('groupHue', () => {
  it('reuses the kanban status hues for status group headers (review remark 6)', () => {
    // WHY: "Doing"/"Reviewing" section titles must look like the kanban column
    // labels (blue / purple) so the cockpit reads as the same status system.
    expect(groupHue('doing')).toBe('blue');
    expect(groupHue('reviewing')).toBe('purple');
  });

  it('returns none for unknown keys', () => {
    expect(groupHue('not-a-status')).toBeNull();
  });
});

describe('shouldRefreezeForStatusChange', () => {
  // WHY: while the inspector is open the list order is FROZEN so ↑/↓ never
  // reshuffles under the cursor. But changing the inspected ticket's status is
  // explicit user intent: its row must move to the new status group live (bug —
  // it only moved after a reload). This helper decides exactly when to
  // re-snapshot, scoped to the inspected ticket so every other row stays frozen.
  it('refreezes when the SAME inspected ticket changes status', () => {
    expect(
      shouldRefreezeForStatusChange({ id: 't1', status: 'doing' }, { id: 't1', status: 'reviewing' }),
    ).toBe(true);
  });

  it('does NOT refreeze on navigation to a different ticket (even a different status)', () => {
    expect(
      shouldRefreezeForStatusChange({ id: 't1', status: 'doing' }, { id: 't2', status: 'reviewing' }),
    ).toBe(false);
    expect(
      shouldRefreezeForStatusChange({ id: 't1', status: 'doing' }, { id: 't2', status: 'doing' }),
    ).toBe(false);
  });

  it('does NOT refreeze on open, close, or an unchanged status', () => {
    expect(shouldRefreezeForStatusChange({ id: null, status: null }, { id: 't1', status: 'doing' })).toBe(false); // open
    expect(shouldRefreezeForStatusChange({ id: 't1', status: 'doing' }, { id: null, status: null })).toBe(false); // close
    expect(shouldRefreezeForStatusChange({ id: 't1', status: 'doing' }, { id: 't1', status: 'doing' })).toBe(false); // no change
  });
});

import { describe, it, expect } from 'vitest';
import type { AgentActivityState, Ticket, TicketStatus } from '@fleex/shared';
import type { ListFocusFilters } from '../../stores/listFocusStore';
import { DEFAULT_LIST_FOCUS_STATUSES } from '../../stores/listFocusStore';
import { buildListFocusGroups, WAITING_GROUP_KEY } from './grouping';

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
  return { boardId: null, statuses: DEFAULT_LIST_FOCUS_STATUSES, favoritesOnly: false, ...partial };
}

const keys = (groups: { key: string }[]) => groups.map((g) => g.key);
const idsOf = (groups: { key: string; tickets: Ticket[] }[], key: string) =>
  groups.find((g) => g.key === key)?.tickets.map((t) => t.id) ?? [];

describe('buildListFocusGroups', () => {
  it('pulls EVERY waiting ticket into one top group, across statuses, and out of its status group (D2)', () => {
    // WHY: decision D2 — a blocked agent must never be hidden behind a status
    // filter. A waiting ticket is surfaced at the top regardless of its status,
    // and must not also appear in its own status group (no double-listing).
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

    // Waiting group is first and holds both waiting tickets regardless of status.
    expect(keys(groups)[0]).toBe(WAITING_GROUP_KEY);
    expect(idsOf(groups, WAITING_GROUP_KEY).sort()).toEqual(['doing-wait', 'review-wait']);

    // The waiting tickets are removed from their status groups…
    expect(idsOf(groups, 'doing')).toEqual(['doing-run']);
    expect(idsOf(groups, 'reviewing')).toEqual([]); // review-wait moved up, so empty
  });

  it('surfaces a waiting ticket even when its status is out of scope (D2 crosses the filter)', () => {
    // WHY: the whole point of the virtual group — a `backlog` ticket is not in
    // the default doing+reviewing scope, but if its agent is blocked it must
    // still appear so the human can unblock it.
    const tickets = [mkTicket({ id: 'backlog-wait', status: 'backlog' })];
    const groups = buildListFocusGroups(tickets, { 'backlog-wait': 'waiting' }, filters());

    expect(idsOf(groups, WAITING_GROUP_KEY)).toEqual(['backlog-wait']);
    // backlog is not a scoped status → no backlog group is rendered.
    expect(keys(groups)).not.toContain('backlog');
  });

  it('omits the waiting group entirely when nothing is waiting, but keeps empty scoped status groups', () => {
    // WHY: stable headers — scoped status columns stay visible as work drains,
    // but the virtual waiting group only exists when it has something to show.
    const tickets = [mkTicket({ id: 'a', status: 'doing' })];
    const groups = buildListFocusGroups(tickets, { a: 'running' }, filters());

    expect(keys(groups)).not.toContain(WAITING_GROUP_KEY);
    expect(keys(groups)).toEqual(['doing', 'reviewing']); // both scoped, reviewing empty
    expect(idsOf(groups, 'reviewing')).toEqual([]);
  });

  it('scopes by board and favorites', () => {
    const tickets = [
      mkTicket({ id: 'b1', boardId: 'board-1', favorite: true }),
      mkTicket({ id: 'b2', boardId: 'board-2', favorite: false }),
      mkTicket({ id: 'b1-nofav', boardId: 'board-1', favorite: false }),
    ];

    const byBoard = buildListFocusGroups(tickets, {}, filters({ boardId: 'board-2' }));
    expect(idsOf(byBoard, 'doing')).toEqual(['b2']);

    const byFav = buildListFocusGroups(tickets, {}, filters({ favoritesOnly: true }));
    expect(idsOf(byFav, 'doing')).toEqual(['b1']);
  });

  it('orders each group: running before idle, then most-recently-moved first', () => {
    // WHY: the most "alive" work should float to the top of a group so the human
    // scans it first — active agents before idle ones, newest movement before old.
    const tickets = [
      mkTicket({ id: 'idle-old', status: 'doing', statusChangedAt: '2026-01-01T00:00:00.000Z' }),
      mkTicket({ id: 'idle-new', status: 'doing', statusChangedAt: '2026-01-03T00:00:00.000Z' }),
      mkTicket({ id: 'run-old', status: 'doing', statusChangedAt: '2026-01-02T00:00:00.000Z' }),
    ];
    const activity: Record<string, AgentActivityState> = {
      'run-old': 'running',
      // the two idle ones are absent → idle
    };

    const groups = buildListFocusGroups(tickets, activity, filters());
    // running first, then idle sorted by recency (new before old).
    expect(idsOf(groups, 'doing')).toEqual(['run-old', 'idle-new', 'idle-old']);
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

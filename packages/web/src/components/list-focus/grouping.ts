import type { Ticket, TicketStatus, AgentActivityState } from '@fleex/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { ListFocusFilters } from '../../stores/listFocusStore';

/**
 * Pure grouping for the List/Focus cockpit (spec §7).
 *
 * A ticket's *status* (doing/reviewing/…) and its *agent activity*
 * (idle/running/waiting) are orthogonal: a `doing` ticket whose agent is
 * blocked on a mention is both `doing` and `waiting`. Decision D2 says the
 * human must never miss a blocked agent behind a status filter, so every
 * `waiting` ticket is pulled into a single virtual group at the very top —
 * across statuses — and removed from its status group to avoid double-listing.
 *
 * The remaining status groups render in canonical column order, restricted to
 * the scoped statuses (default doing+reviewing, D5), each sorted so the most
 * "alive" work floats up: running before idle, then most-recently-moved first.
 */

export const WAITING_GROUP_KEY = '__waiting__';
export const WAITING_GROUP_LABEL = 'En attente';

export interface ListFocusGroup {
  /** Stable key (status id, or the virtual waiting key) used for collapse state. */
  key: string;
  label: string;
  tickets: Ticket[];
}

const ACTIVITY_RANK: Record<AgentActivityState, number> = { waiting: 2, running: 1, idle: 0 };

function passesScope(t: Ticket, filters: ListFocusFilters): boolean {
  if (filters.boardId && t.boardId !== filters.boardId) return false;
  if (filters.favoritesOnly && !t.favorite) return false;
  return true;
}

function recency(t: Ticket): number {
  return new Date(t.statusChangedAt).getTime();
}

/** Running/waiting before idle, then most recently moved first. */
function orderBy(activityByTicket: Record<string, AgentActivityState>) {
  return (a: Ticket, b: Ticket): number => {
    const ra = ACTIVITY_RANK[activityByTicket[a.id] ?? 'idle'];
    const rb = ACTIVITY_RANK[activityByTicket[b.id] ?? 'idle'];
    if (ra !== rb) return rb - ra;
    return recency(b) - recency(a);
  };
}

export function buildListFocusGroups(
  tickets: Ticket[],
  activityByTicket: Record<string, AgentActivityState>,
  filters: ListFocusFilters,
): ListFocusGroup[] {
  const inScope = tickets.filter((t) => passesScope(t, filters));
  const order = orderBy(activityByTicket);

  // Virtual "En attente" group — every waiting ticket regardless of status (D2).
  const waiting = inScope
    .filter((t) => (activityByTicket[t.id] ?? 'idle') === 'waiting')
    .sort(order);
  const waitingIds = new Set(waiting.map((t) => t.id));

  const groups: ListFocusGroup[] = [];
  if (waiting.length) {
    groups.push({ key: WAITING_GROUP_KEY, label: WAITING_GROUP_LABEL, tickets: waiting });
  }

  // Scoped status groups in canonical column order (D5). Empty scoped groups are
  // still rendered so the header/scope stays stable as work drains out of them.
  const scoped = new Set(filters.statuses);
  for (const status of TICKET_STATUSES as readonly TicketStatus[]) {
    if (!scoped.has(status)) continue;
    const rows = inScope
      .filter((t) => t.status === status && !waitingIds.has(t.id))
      .sort(order);
    groups.push({ key: status, label: TICKET_STATUS_LABELS[status] ?? status, tickets: rows });
  }

  return groups;
}

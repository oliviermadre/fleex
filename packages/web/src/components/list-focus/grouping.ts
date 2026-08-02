import type { Ticket, TicketStatus, AgentActivityState } from '@fleex/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';

import { STATUS_HUES } from '../../lib/statusColors';

import type { TintHue } from '../../lib/tints';
import type { ListFocusFilters } from '../../stores/listFocusStore';

/**
 * Pure grouping for the List/Focus cockpit (spec §7).
 *
 * Pass 4 (remark 3) removed D2's virtual "En attente" group: NaS prefers a
 * waiting badge on the row over a grouping, so tickets always stay in their
 * status group and the activity column carries the waiting/running/idle
 * signal. Waiting tickets still float to the top of their group
 * (waiting > running > idle, then most-recently-moved) so blocked agents
 * remain easy to spot.
 *
 * Status groups render in canonical column order, restricted to the scoped
 * statuses (default doing+reviewing, D5). All other filters are multi-select
 * with "empty = all" semantics (pass 4, remark 1).
 */

export interface ListFocusGroup {
  /** Stable key (the status id) used for collapse state. */
  key: string;
  label: string;
  tickets: Ticket[];
}

const ACTIVITY_RANK: Record<AgentActivityState, number> = { waiting: 2, running: 1, idle: 0 };

function passesScope(t: Ticket, filters: ListFocusFilters): boolean {
  if (filters.boardIds.length > 0 && !filters.boardIds.includes(t.boardId)) return false;
  if (filters.favoritesOnly && !t.favorite) return false;
  if (filters.types.length > 0 && (!t.type || !filters.types.includes(t.type))) return false;
  if (filters.priorities.length > 0 && !filters.priorities.includes(t.priority)) return false;
  const query = filters.titleQuery.trim().toLowerCase();
  if (query && !t.title.toLowerCase().includes(query)) return false;
  return true;
}

/**
 * Tint hue for a group header: reuse the kanban status colors (doing=blue,
 * reviewing=purple — review remark 6) so the cockpit reads as the same
 * status system.
 */
export function groupHue(key: string): TintHue | null {
  return STATUS_HUES[key] ?? null;
}

function recency(t: Ticket): number {
  return new Date(t.statusChangedAt).getTime();
}

/** Waiting before running before idle, then most recently moved first. */
function orderBy(activityByTicket: Record<string, AgentActivityState>) {
  return (a: Ticket, b: Ticket): number => {
    const ra = ACTIVITY_RANK[activityByTicket[a.id] ?? 'idle'];
    const rb = ACTIVITY_RANK[activityByTicket[b.id] ?? 'idle'];
    if (ra !== rb) return rb - ra;
    return recency(b) - recency(a);
  };
}

/**
 * Decide whether an open inspector should re-snapshot ("refreeze") its frozen
 * group order in response to the selected ticket's status.
 *
 * The list order is frozen while the inspector is open so ↑/↓ navigation never
 * reshuffles the rows under the cursor. Changing the INSPECTED ticket's status,
 * though, is explicit user intent: its row must move to the new status group
 * live (otherwise it only moves after a reload). Returns true only when the
 * SAME ticket's status changed — never on open (`prev.id` null), close
 * (`next.id` null), or navigation to another ticket (id changed) — so every
 * other row stays protected by the freeze.
 */
export function shouldRefreezeForStatusChange(
  prev: { id: string | null; status: TicketStatus | null },
  next: { id: string | null; status: TicketStatus | null },
): boolean {
  return next.id !== null && prev.id === next.id && prev.status !== next.status;
}

export function buildListFocusGroups(
  tickets: Ticket[],
  activityByTicket: Record<string, AgentActivityState>,
  filters: ListFocusFilters,
): ListFocusGroup[] {
  const inScope = tickets.filter((t) => passesScope(t, filters));
  const order = orderBy(activityByTicket);

  // Scoped status groups in canonical column order (D5). Empty scoped groups are
  // still rendered so the header/scope stays stable as work drains out of them.
  const scoped = new Set(filters.statuses);
  const groups: ListFocusGroup[] = [];
  for (const status of TICKET_STATUSES as readonly TicketStatus[]) {
    if (!scoped.has(status)) continue;
    const rows = inScope.filter((t) => t.status === status).sort(order);
    groups.push({ key: status, label: TICKET_STATUS_LABELS[status] ?? status, tickets: rows });
  }

  return groups;
}

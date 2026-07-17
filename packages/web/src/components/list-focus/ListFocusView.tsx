import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Ticket, TicketStatus } from '@fleex/shared';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { useUnreadStore } from '../../stores/unreadStore';
import {
  useListFocusStore,
  type InspectorFocus,
  type ListFocusGroupSnapshot,
} from '../../stores/listFocusStore';
import { appWs } from '../../services/websocket';
import { fetchBulkPRStates } from '../../services/api';
import {
  buildListFocusGroups,
  WAITING_GROUP_KEY,
  type ListFocusGroup,
} from './grouping';
import { ListFocusRow, LIST_FOCUS_COL } from './ListFocusRow';
import { ListFocusInspector } from './ListFocusInspector';
import { tint } from '../../lib/tints';
import { cn } from '../../lib/cn';

const EMPTY_UNREAD = {
  ticketId: '',
  totalComments: 0,
  totalDeliverables: 0,
  unreadComments: 0,
  unreadDeliverables: 0,
} as const;

const UNREAD_REFETCH_DEBOUNCE_MS = 300;

/** WS event types that change a ticket's comment/deliverable badge counts. */
function affectsUnread(type: string): boolean {
  return (
    type === 'comment:created' ||
    type === 'comment:updated' ||
    type === 'comment:deleted' ||
    type.startsWith('deliverable:')
  );
}

/**
 * List/Focus cockpit (view #400) — a cross-board monitoring surface. Rows (not
 * kanban columns) grouped by status, a virtual "En attente" group at the top for
 * every blocked agent (D2), and a resizable right inspector exposing the three
 * triage actions: change status, read deliverables, relaunch via comment.
 *
 * Ticket data, agent activity, unread badges and PR states all come from their
 * existing stores; this view only orchestrates them and owns the view-local
 * selection/order-freeze via useListFocusStore.
 */
export function ListFocusView() {
  const navigate = useNavigate();

  const tickets = useTicketStore((s) => s.tickets);
  const rawBoards = useTicketStore((s) => s.boards);
  const moveTicket = useTicketStore((s) => s.moveTicket);

  const activityByTicket = useTicketActivityStore((s) => s.activityByTicket);
  const detailByTicket = useTicketActivityStore((s) => s.detailByTicket);
  const loadActivity = useTicketActivityStore((s) => s.loadActivity);

  const unreadByTicket = useUnreadStore((s) => s.unreadByTicket);
  const loadUnreadCounts = useUnreadStore((s) => s.loadUnreadCounts);

  const selectedTicketId = useListFocusStore((s) => s.selectedTicketId);
  const inspectorFocus = useListFocusStore((s) => s.inspectorFocus);
  const frozenGroups = useListFocusStore((s) => s.frozenGroups);
  const collapsedGroups = useListFocusStore((s) => s.collapsedGroups);
  const filters = useListFocusStore((s) => s.filters);
  const open = useListFocusStore((s) => s.open);
  const close = useListFocusStore((s) => s.close);
  const selectRelative = useListFocusStore((s) => s.selectRelative);
  const toggleGroup = useListFocusStore((s) => s.toggleGroup);
  const setFilters = useListFocusStore((s) => s.setFilters);

  const [prStates, setPrStates] = useState<Record<string, string>>({});
  const parentRef = useRef<HTMLDivElement>(null);

  const boards = useMemo(
    () => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)),
    [rawBoards],
  );
  const boardById = useMemo(() => new Map(boards.map((b) => [b.id, b])), [boards]);
  const ticketById = useMemo(() => new Map(tickets.map((t) => [t.id, t])), [tickets]);
  const ticketIds = useMemo(() => tickets.map((t) => t.id), [tickets]);

  // ── Data loading ────────────────────────────────────────────────────────────
  // Track ALL tickets (not just the scoped statuses) so the virtual "waiting"
  // group can surface a blocked agent even when its status is filtered out (D2).
  useEffect(() => {
    loadActivity(ticketIds);
  }, [ticketIds, loadActivity]);
  useEffect(() => {
    loadUnreadCounts(ticketIds);
  }, [ticketIds, loadUnreadCounts]);

  // Live PR states for every ticket carrying a github_pr link (v1 = state only).
  useEffect(() => {
    const refs = new Set<string>();
    for (const t of tickets) {
      for (const link of t.links) {
        if (link.type === 'github_pr') refs.add(link.ref);
      }
    }
    if (refs.size === 0) return;
    fetchBulkPRStates([...refs]).then(setPrStates).catch(() => {});
  }, [tickets]);

  // unreadStore is not globally WS-wired, so refetch (debounced) when a comment
  // or deliverable event lands for any ticket we're tracking.
  const ticketIdsRef = useRef(ticketIds);
  ticketIdsRef.current = ticketIds;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = appWs.onChannel('tickets', (msg) => {
      if (!affectsUnread(msg.type)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void loadUnreadCounts(ticketIdsRef.current);
      }, UNREAD_REFETCH_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsub();
    };
  }, [loadUnreadCounts]);

  // ── Grouping (live vs. frozen while the inspector is open, D3) ───────────────
  const liveGroups = useMemo(
    () => buildListFocusGroups(tickets, activityByTicket, filters),
    [tickets, activityByTicket, filters],
  );

  const displayGroups: ListFocusGroup[] = useMemo(() => {
    if (selectedTicketId && frozenGroups) {
      // Render the snapshot taken at open time so ↑/↓ never jumps under the
      // cursor. Resolve ids to live tickets and drop any that were deleted.
      return frozenGroups.map((g) => ({
        key: g.key,
        label: g.label,
        tickets: g.ticketIds
          .map((id) => ticketById.get(id))
          .filter((t): t is Ticket => !!t),
      }));
    }
    return liveGroups;
  }, [selectedTicketId, frozenGroups, ticketById, liveGroups]);

  const snapshot = useCallback(
    (): ListFocusGroupSnapshot[] =>
      liveGroups.map((g) => ({
        key: g.key,
        label: g.label,
        ticketIds: g.tickets.map((t) => t.id),
      })),
    [liveGroups],
  );

  const handleOpen = useCallback(
    (ticketId: string, focus?: InspectorFocus) => {
      open(ticketId, snapshot(), focus ?? null);
    },
    [open, snapshot],
  );

  const handleStatusChange = useCallback(
    (ticketId: string, status: TicketStatus) => {
      void moveTicket(ticketId, status);
    },
    [moveTicket],
  );

  // ── Keyboard navigation (owned here so it works regardless of focus) ─────────
  // Capture phase: fires before the composer's own keydown (which stops
  // propagation), so Escape closes even while typing, while ↑/↓ stay inert
  // inside form fields so the caret can move normally.
  useEffect(() => {
    if (!selectedTicketId) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isFormField =
        tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!target?.isContentEditable;
      if (isFormField) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectRelative(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectRelative(-1);
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [selectedTicketId, close, selectRelative]);

  // ── Inspector position label (from the flattened frozen order) ───────────────
  const flatFrozen = useMemo(
    () => (frozenGroups ? frozenGroups.flatMap((g) => g.ticketIds) : []),
    [frozenGroups],
  );
  const selectedTicket = selectedTicketId ? ticketById.get(selectedTicketId) ?? null : null;
  const selectedIndex = selectedTicketId ? flatFrozen.indexOf(selectedTicketId) : -1;
  const positionLabel = selectedIndex >= 0 ? `${selectedIndex + 1} / ${flatFrozen.length}` : '';

  const toggleStatusScope = useCallback(
    (status: TicketStatus) => {
      const next = new Set(filters.statuses);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      setFilters({ statuses: (TICKET_STATUSES as readonly TicketStatus[]).filter((s) => next.has(s)) });
    },
    [filters.statuses, setFilters],
  );

  const totalRows = displayGroups.reduce((n, g) => n + g.tickets.length, 0);

  return (
    <div className="flex h-full flex-col bg-[var(--theme-bg-base)]">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--theme-border)] px-4 py-2.5">
        <h1 className="mr-2 text-sm font-semibold text-[var(--theme-text-primary)]">Cockpit</h1>

        <select
          value={filters.boardId ?? ''}
          onChange={(e) => setFilters({ boardId: e.target.value || null })}
          className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-secondary)] focus:border-[var(--theme-accent)] focus:outline-none"
        >
          <option value="">All boards</option>
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.emoji} {b.name}
            </option>
          ))}
        </select>

        <div className="flex items-center gap-1">
          {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => {
            const on = filters.statuses.includes(s);
            return (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatusScope(s)}
                aria-pressed={on}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
                  on
                    ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                    : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
                )}
              >
                {TICKET_STATUS_LABELS[s] ?? s}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setFilters({ favoritesOnly: !filters.favoritesOnly })}
          aria-pressed={filters.favoritesOnly}
          title="Only favorites"
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors',
            filters.favoritesOnly
              ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
              : 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]',
          )}
        >
          ★ Favorites
        </button>
      </div>

      {/* List + inspector */}
      <div ref={parentRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Column header */}
          <div className="flex items-center gap-3 border-b border-[var(--theme-border-subtle)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--theme-text-faint)]">
            <div className={LIST_FOCUS_COL.activity}>Activity</div>
            <div className={LIST_FOCUS_COL.main}>Ticket</div>
            <div className={LIST_FOCUS_COL.waiting}>En attente de</div>
            <div className={LIST_FOCUS_COL.pr}>PR / CI</div>
            <div className={cn(LIST_FOCUS_COL.badge, 'text-center')}>💬</div>
            <div className={cn(LIST_FOCUS_COL.badge, 'text-center')}>📦</div>
            <div className={LIST_FOCUS_COL.status}>Status</div>
          </div>

          {/* Rows */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {totalRows === 0 ? (
              <div className="flex h-full items-center justify-center px-4 text-center text-xs text-[var(--theme-text-faint)]">
                No tickets in scope. Adjust the board or status filters above.
              </div>
            ) : (
              displayGroups.map((group) => {
                const collapsed = collapsedGroups.has(group.key);
                const isWaiting = group.key === WAITING_GROUP_KEY;
                return (
                  <section key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleGroup(group.key)}
                      className="sticky top-0 z-10 flex w-full items-center gap-2 border-b border-[var(--theme-border-subtle)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)]"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={cn(
                          'text-[var(--theme-text-muted)] transition-transform',
                          collapsed ? '' : 'rotate-90',
                        )}
                      >
                        <polyline points="6,4 10,8 6,12" />
                      </svg>
                      <span
                        className={cn(
                          'text-xs font-semibold',
                          isWaiting
                            ? cn('rounded px-1.5 py-0.5', tint('yellow'))
                            : 'text-[var(--theme-text-secondary)]',
                        )}
                      >
                        {isWaiting && <span aria-hidden>⏳ </span>}
                        {group.label}
                      </span>
                      <span className="text-[10px] tabular-nums text-[var(--theme-text-faint)]">
                        {group.tickets.length}
                      </span>
                    </button>

                    {!collapsed &&
                      group.tickets.map((ticket) => (
                        <ListFocusRow
                          key={ticket.id}
                          ticket={ticket}
                          board={boardById.get(ticket.boardId)}
                          activity={activityByTicket[ticket.id] ?? 'idle'}
                          detail={detailByTicket[ticket.id]}
                          unread={unreadByTicket[ticket.id] ?? { ...EMPTY_UNREAD, ticketId: ticket.id }}
                          prStates={prStates}
                          selected={ticket.id === selectedTicketId}
                          onOpen={(focus) => handleOpen(ticket.id, focus)}
                          onStatusChange={(status) => handleStatusChange(ticket.id, status)}
                        />
                      ))}
                  </section>
                );
              })
            )}
          </div>
        </div>

        {selectedTicket && (
          <ListFocusInspector
            ticket={selectedTicket}
            board={boardById.get(selectedTicket.boardId)}
            focus={inspectorFocus}
            positionLabel={positionLabel}
            parentRef={parentRef}
            onClose={close}
            onStatusChange={(status) => handleStatusChange(selectedTicket.id, status)}
            onOpenFull={() =>
              navigate(`/tickets/board/${selectedTicket.boardId}/ticket/${selectedTicket.id}`)
            }
          />
        )}
      </div>
    </div>
  );
}

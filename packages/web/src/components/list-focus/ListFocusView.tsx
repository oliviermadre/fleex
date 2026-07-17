import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Ticket, TicketPriority, TicketStatus, TicketType } from '@fleex/shared';
import {
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
} from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { useUnreadStore } from '../../stores/unreadStore';
import {
  useListFocusStore,
  type InspectorFocus,
  type ListFocusFilters,
  type ListFocusGroupSnapshot,
} from '../../stores/listFocusStore';
import { appWs } from '../../services/websocket';
import { fetchBulkPRStates } from '../../services/api';
import { buildListFocusGroups, groupHue, type ListFocusGroup } from './grouping';
import { ListFocusRow, LIST_FOCUS_COL } from './ListFocusRow';
import { ListFocusInspector } from './ListFocusInspector';
import { CommentIcon, DeliverableIcon } from './icons';
import { STATUS_COLOR } from './StatusChipDropdown';
import { ToolbarMultiSelect } from './ToolbarSelect';
import { PriorityIndicator, PRIORITY_LABELS } from '../tickets/PriorityIndicator';
import { TYPE_ICONS } from '../tickets/TicketTypeBadge';
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
 * kanban columns) grouped by status, an activity badge column per row
 * (waiting/running/idle since — pass 4 replaced D2's virtual "En attente"
 * group with this badge), and a resizable right inspector exposing the three
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
  const updateTicket = useTicketStore((s) => s.updateTicket);

  const activityByTicket = useTicketActivityStore((s) => s.activityByTicket);
  const detailByTicket = useTicketActivityStore((s) => s.detailByTicket);
  const lastActivityAtByTicket = useTicketActivityStore((s) => s.lastActivityAtByTicket);
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
  const refreeze = useListFocusStore((s) => s.refreeze);
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
  // Track ALL tickets (not just the scoped statuses) so the activity badges and
  // "idle since" ages stay warm as the user widens the status scope.
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

  // Filter clicks are user intent: re-snapshot the frozen order from the
  // freshly-filtered live groups so filters apply even while the inspector is
  // open (review remark 4). D3's freeze keeps protecting against ambient
  // reordering only. Keyed on the store's `filters` identity (stable across
  // remounts), so returning to the view never reshuffles an open inspector.
  const prevFiltersRef = useRef(filters);
  useEffect(() => {
    if (prevFiltersRef.current === filters) return;
    prevFiltersRef.current = filters;
    refreeze(snapshot());
  }, [filters, refreeze, snapshot]);

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

  /** Toggle a value in/out of a multi-select filter array (pass 4, remark 1). */
  const toggleIn = useCallback(
    <K extends 'boardIds' | 'types' | 'priorities'>(key: K, value: ListFocusFilters[K][number]) => {
      const current = filters[key] as string[];
      setFilters({
        [key]: current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value],
      } as Partial<ListFocusFilters>);
    },
    [filters, setFilters],
  );

  const totalRows = displayGroups.reduce((n, g) => n + g.tickets.length, 0);

  return (
    // w-full + overflow-hidden: as a flex item of AppLayout's main area this
    // root must NOT size to its content's intrinsic width, otherwise wide rows
    // push the inspector off-screen (review bug: sidebar hidden until groups
    // were collapsed). Same convention as ExecutionLogPage.
    <div className="flex h-full w-full flex-col overflow-hidden bg-[var(--theme-bg-base)]">
      {/* Toolbar — all filters sit on the RIGHT behind a "Filters :" label
          (pass 4, remark 1), every one multi-select (empty = all, "All" badge)
          except the favorites flag, plus a free-text title filter. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--theme-border)] px-4 py-2.5">
        <h1 className="mr-2 text-sm font-semibold text-[var(--theme-text-primary)]">Cockpit</h1>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--theme-text-faint)]">
            Filters :
          </span>

          <input
            type="search"
            value={filters.titleQuery}
            onChange={(e) => setFilters({ titleQuery: e.target.value })}
            placeholder="Filter by title…"
            className="w-44 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
          />

          <ToolbarMultiSelect
            label="Boards"
            zeroLabel="All"
            values={filters.boardIds}
            options={boards.map((b) => ({
              value: b.id,
              label: b.name,
              icon: <span>{b.emoji}</span>,
            }))}
            onToggle={(id) => toggleIn('boardIds', id)}
          />

          <ToolbarMultiSelect
            label="Status"
            values={filters.statuses}
            options={(TICKET_STATUSES as readonly TicketStatus[]).map((s) => ({
              value: s,
              label: TICKET_STATUS_LABELS[s] ?? s,
              icon: (
                <span
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR[s] }}
                />
              ),
            }))}
            onToggle={toggleStatusScope}
          />

          <ToolbarMultiSelect
            label="Types"
            zeroLabel="All"
            values={filters.types}
            options={TICKET_TYPES.map((t: TicketType) => ({
              value: t,
              label: TICKET_TYPE_LABELS[t] ?? t,
              icon: <span>{TYPE_ICONS[t]}</span>,
            }))}
            onToggle={(t) => toggleIn('types', t)}
          />

          <ToolbarMultiSelect
            label="Priorities"
            zeroLabel="All"
            values={filters.priorities}
            options={TICKET_PRIORITIES.map((p: TicketPriority) => ({
              value: p,
              label: PRIORITY_LABELS[p] ?? p,
              icon: <PriorityIndicator priority={p} />,
            }))}
            onToggle={(p) => toggleIn('priorities', p)}
          />

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
      </div>

      {/* List + inspector */}
      <div ref={parentRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Column header — id · pictos · type · title · activity · board · PR
              (pass 4, remarks 2 + 5). */}
          <div className="flex items-center gap-3 border-b border-[var(--theme-border-subtle)] px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--theme-text-faint)]">
            <div className={LIST_FOCUS_COL.id}>ID</div>
            {/* ★ + priority pictos column — no label needed, kept for alignment. */}
            <div className={LIST_FOCUS_COL.pictos}>
              <span className="sr-only">Favorite / priority</span>
            </div>
            <div className={LIST_FOCUS_COL.type}>Type</div>
            <div className={LIST_FOCUS_COL.main}>Ticket</div>
            <div className={LIST_FOCUS_COL.activity}>Activity</div>
            <div className={LIST_FOCUS_COL.board}>Board</div>
            <div className={LIST_FOCUS_COL.pr}>PR</div>
            <div className={cn(LIST_FOCUS_COL.badge, 'flex justify-center')} title="Comments">
              <CommentIcon />
              <span className="sr-only">Comments</span>
            </div>
            <div className={cn(LIST_FOCUS_COL.badge, 'flex justify-center')} title="Deliverables">
              <DeliverableIcon />
              <span className="sr-only">Deliverables</span>
            </div>
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
                // Kanban status colors on section titles (review remark 6).
                const hue = groupHue(group.key);
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
                          hue
                            ? cn('rounded px-1.5 py-0.5', tint(hue))
                            : 'text-[var(--theme-text-secondary)]',
                        )}
                      >
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
                          lastActivityAt={lastActivityAtByTicket[ticket.id] ?? null}
                          unread={unreadByTicket[ticket.id] ?? { ...EMPTY_UNREAD, ticketId: ticket.id }}
                          prStates={prStates}
                          selected={ticket.id === selectedTicketId}
                          onOpen={(focus) => handleOpen(ticket.id, focus)}
                          onToggleFavorite={() => void updateTicket(ticket.id, { favorite: !ticket.favorite })}
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

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { TicketStatus } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { MobileTicketCard } from './MobileTicketCard';
import { QuickAddFab, QuickAddSheet } from './MobileQuickAdd';
import { MobilePageHeader } from './MobilePageHeader';
import { KanbanIcon } from './MobileIcons';
import { tintSolid } from '../lib/tints';
import { useColumnSwipe, COLUMN_EASING, COLUMN_MS } from './useColumnSwipe';

const STATUS_DOT: Record<TicketStatus, string> = {
  backlog: tintSolid('gray'),
  todo: tintSolid('orange'),
  doing: tintSolid('blue'),
  reviewing: tintSolid('purple'),
  done: tintSolid('green'),
  cancelled: tintSolid('gray'),
};

const DEFAULT_COLUMN_INDEX = TICKET_STATUSES.indexOf('doing');
/** Width (px) of the neighbouring columns left visible, and the gap between columns. */
const PEEK = 14;
const GAP = 8;

export function MobileBoard() {
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(
    () => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)),
    [rawBoards],
  );
  const selectedBoardId = useTicketStore((s) => s.selectedBoardId);
  const selectBoard = useTicketStore((s) => s.selectBoard);
  const selectTicket = useTicketStore((s) => s.selectTicket);
  const ticketsByColumn = useTicketStore((s) => s.ticketsByColumn);
  // Subscribe to tickets so the derived ticketsByColumn re-renders on WS updates
  useTicketStore((s) => s.tickets);

  const columns = ticketsByColumn(selectedBoardId);
  const isAllBoards = selectedBoardId === null && boards.length > 1;
  const boardNameById = useMemo(
    () => Object.fromEntries(boards.map((b) => [b.id, b.name])),
    [boards],
  );

  const [activeIdx, setActiveIdx] = useState(DEFAULT_COLUMN_INDEX);
  const lastIdx = TICKET_STATUSES.length - 1;

  const goToColumn = useCallback(
    (idx: number) => setActiveIdx(Math.max(0, Math.min(lastIdx, idx))),
    [lastIdx],
  );

  // Columns are sized from the viewport width so neighbours peek on each side.
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    setViewportWidth(el.clientWidth);
    const ro = new ResizeObserver(() => setViewportWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const columnWidth = Math.max(0, viewportWidth - 2 * (PEEK + GAP));
  const step = columnWidth + GAP;

  const activeStatus = TICKET_STATUSES[activeIdx] ?? 'todo';
  const prevStatus = TICKET_STATUSES[activeIdx - 1];
  const nextStatus = TICKET_STATUSES[activeIdx + 1];

  const { dx, dragging, touchProps } = useColumnSwipe({
    idx: activeIdx,
    count: TICKET_STATUSES.length,
    pageWidth: step,
    onChange: goToColumn,
  });

  // ── Quick add ──
  const [adding, setAdding] = useState(false);
  const canAdd = !!(selectedBoardId ?? boards[0]?.id);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: same layout as every screen, the board picker sits on the title line */}
      <MobilePageHeader
        title="Kanban"
        icon={<KanbanIcon size={24} />}
        trailing={
          <div className="relative min-w-0 max-w-[58vw]">
            <select
              value={selectedBoardId ?? '__all__'}
              onChange={(e) => selectBoard(e.target.value === '__all__' ? null : e.target.value)}
              aria-label="Board"
              className="h-11 w-full min-w-0 appearance-none truncate rounded-[10px] bg-[var(--theme-bg-surface)] pl-3 pr-8 text-sm font-semibold text-[var(--theme-text-primary)]"
            >
              {boards.length > 1 && <option value="__all__">Tous les boards</option>}
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.emoji ? `${b.emoji} ` : ''}{b.name}
                </option>
              ))}
            </select>
            <span aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--theme-text-muted)]">▾</span>
          </div>
        }
      />

      {/* Carousel header: the visible column in the middle, its neighbours on each side */}
      <nav aria-label="Colonnes" className="shrink-0 px-1">
        <div className="grid grid-cols-[1fr_auto_1fr] items-center">
          {prevStatus ? (
            <button
              onClick={() => goToColumn(activeIdx - 1)}
              className="flex h-11 min-w-0 items-center gap-1 justify-self-start px-2 text-[13px] text-[var(--theme-text-muted)]"
            >
              <span aria-hidden className="text-base leading-none">‹</span>
              <span className="truncate">{TICKET_STATUS_LABELS[prevStatus]}</span>
            </button>
          ) : <span />}
          <p aria-live="polite" className="flex items-center gap-2 px-2 text-[15px] font-semibold text-[var(--theme-text-primary)]">
            <span className={`h-2 w-2 rounded-full ${STATUS_DOT[activeStatus]}`} />
            {TICKET_STATUS_LABELS[activeStatus]}
            <span className="font-normal tabular-nums text-[var(--theme-text-muted)]">{columns[activeStatus]?.length ?? 0}</span>
          </p>
          {nextStatus ? (
            <button
              onClick={() => goToColumn(activeIdx + 1)}
              className="flex h-11 min-w-0 items-center gap-1 justify-self-end px-2 text-[13px] text-[var(--theme-text-muted)]"
            >
              <span className="truncate">{TICKET_STATUS_LABELS[nextStatus]}</span>
              <span aria-hidden className="text-base leading-none">›</span>
            </button>
          ) : <span />}
        </div>
        {/* Position dots */}
        <div aria-hidden className="flex justify-center gap-1.5 pb-2">
          {(TICKET_STATUSES as readonly TicketStatus[]).map((status, idx) => (
            <span
              key={status}
              className={`h-1.5 rounded-full transition-all duration-300 ${
                idx === activeIdx ? `w-4 ${STATUS_DOT[status]}` : 'w-1.5 bg-[var(--theme-text-faint)] opacity-50'
              }`}
            />
          ))}
        </div>
      </nav>

      {/* Columns: a track moved with a transform, following the finger */}
      <div
        ref={viewportRef}
        className="min-h-0 flex-1 overflow-hidden"
        style={{ touchAction: 'pan-y' }}
        {...touchProps}
      >
        <div
          className="flex h-full"
          style={{
            gap: GAP,
            transform: `translateX(${PEEK + GAP - activeIdx * step + dx}px)`,
            transition: dragging ? 'none' : `transform ${COLUMN_MS}ms ${COLUMN_EASING}`,
          }}
        >
          {(TICKET_STATUSES as readonly TicketStatus[]).map((status, idx) => {
            const tickets = columns[status] ?? [];
            const active = idx === activeIdx;
            return (
              <section
                key={status}
                aria-label={TICKET_STATUS_LABELS[status]}
                className="relative flex h-full flex-none flex-col overflow-hidden rounded-t-2xl bg-[var(--theme-bg-surface)] transition-opacity duration-300"
                style={{ width: columnWidth, opacity: active ? 1 : 0.55 }}
              >
                <div className={`h-1 shrink-0 ${STATUS_DOT[status]}`} />
                <div
                  className="min-h-0 flex-1 px-2 pt-2"
                  style={{
                    overflowY: dragging ? 'hidden' : 'auto',
                    paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)',
                  }}
                >
                  {tickets.length === 0 ? (
                    <p className="py-10 text-center text-sm text-[var(--theme-text-faint)]">Aucun ticket</p>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {tickets.map((t) => (
                        <MobileTicketCard
                          key={t.id}
                          ticket={t}
                          boardName={isAllBoards ? boardNameById[t.boardId] : undefined}
                          onOpen={() => selectTicket(t.id)}
                        />
                      ))}
                    </div>
                  )}
                </div>
                {/* A neighbour is a target, not content: a tap on its edge brings it in */}
                {!active && (
                  <button
                    aria-label={`Aller à ${TICKET_STATUS_LABELS[status]}`}
                    onClick={() => goToColumn(idx)}
                    className="absolute inset-0"
                  />
                )}
              </section>
            );
          })}
        </div>
      </div>

      {/* Quick add (same sheet and button as Tasks) */}
      {canAdd && !adding && <QuickAddFab onClick={() => setAdding(true)} />}
      {adding && (
        <QuickAddSheet
          status={activeStatus}
          defaultBoardId={selectedBoardId ?? boards[0]?.id ?? null}
          onClose={() => setAdding(false)}
        />
      )}
    </div>
  );
}

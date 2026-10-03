import { useCallback, useMemo, useRef, useState } from 'react';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { TicketStatus } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { MobileTicketCard } from './MobileTicketCard';
import { QuickAddFab, QuickAddSheet } from './MobileQuickAdd';
import { MobilePageHeader } from './MobilePageHeader';
import { KanbanIcon } from './MobileIcons';
import { tintSolid } from '../lib/tints';

const STATUS_DOT: Record<TicketStatus, string> = {
  backlog: tintSolid('gray'),
  todo: tintSolid('orange'),
  doing: tintSolid('blue'),
  reviewing: tintSolid('purple'),
  done: tintSolid('green'),
  cancelled: tintSolid('gray'),
};

const DEFAULT_COLUMN_INDEX = TICKET_STATUSES.indexOf('doing');

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
  const touchStartX = useRef<number | null>(null);
  const lastIdx = TICKET_STATUSES.length - 1;

  const goToColumn = useCallback(
    (idx: number) => setActiveIdx(Math.max(0, Math.min(lastIdx, idx))),
    [lastIdx],
  );

  // Swipe pages the track: |dx| > 50px moves one column. (Native scroll-snap
  // fought re-renders from WS updates.)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    const end = e.changedTouches[0]?.clientX;
    if (start === null || end === undefined) return;
    const dx = end - start;
    if (Math.abs(dx) > 50) goToColumn(activeIdx + (dx < 0 ? 1 : -1));
  };

  // ── Quick add ──
  const [adding, setAdding] = useState(false);
  const activeStatus = TICKET_STATUSES[activeIdx] ?? 'todo';
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

      {/* Status chips */}
      <nav className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        {(TICKET_STATUSES as readonly TicketStatus[]).map((status, idx) => {
          const count = columns[status]?.length ?? 0;
          const active = idx === activeIdx;
          return (
            <button
              key={status}
              onClick={() => goToColumn(idx)}
              className={`flex shrink-0 items-center gap-1.5 min-h-11 whitespace-nowrap rounded-full px-4 text-[13px] font-medium transition-colors ${
                active
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                  : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
              {TICKET_STATUS_LABELS[status]}
              <span className={active ? 'opacity-80' : 'opacity-60'}>{count}</span>
            </button>
          );
        })}
      </nav>

      {/* Swipeable columns: a 500%-wide track moved with a transform */}
      <div className="min-h-0 flex-1 overflow-hidden" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div
          className="flex h-full"
          style={{
            width: `${TICKET_STATUSES.length * 100}%`,
            transform: `translateX(-${(activeIdx * 100) / TICKET_STATUSES.length}%)`,
            transition: 'transform 250ms cubic-bezier(0.16, 1, 0.3, 1)',
          }}
        >
          {(TICKET_STATUSES as readonly TicketStatus[]).map((status) => {
            const tickets = columns[status] ?? [];
            return (
              <div
                key={status}
                className="flex h-full flex-none flex-col overflow-y-auto px-3"
                style={{ width: `${100 / TICKET_STATUSES.length}%`, paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}
              >
                {tickets.length === 0 ? (
                  <p className="py-10 text-center text-sm text-[var(--theme-text-faint)]">Aucun ticket</p>
                ) : (
                  <div className="flex flex-col gap-2 py-1">
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

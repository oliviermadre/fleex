import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { TicketStatus } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { MobileTicketCard } from './MobileTicketCard';
import { setMobileOverride } from './useMobileMode';
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
  const createTicket = useTicketStore((s) => s.createTicket);
  // Subscribe to tickets so the derived ticketsByColumn re-renders on WS updates
  useTicketStore((s) => s.tickets);

  const columns = ticketsByColumn(selectedBoardId);
  const isAllBoards = selectedBoardId === null && boards.length > 1;
  const boardNameById = useMemo(
    () => Object.fromEntries(boards.map((b) => [b.id, b.name])),
    [boards],
  );

  const [activeIdx, setActiveIdx] = useState(DEFAULT_COLUMN_INDEX);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const programmaticScrollRef = useRef(false);

  // Position the scroller on the initial column before first paint.
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollLeft = DEFAULT_COLUMN_INDEX * el.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToColumn = useCallback((idx: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    setActiveIdx(idx);
    programmaticScrollRef.current = true;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
    // Release the lock once the smooth scroll has settled
    setTimeout(() => {
      programmaticScrollRef.current = false;
    }, 400);
  }, []);

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const el = scrollerRef.current;
    if (!el) return;
    const idx = Math.round(el.scrollLeft / el.clientWidth);
    setActiveIdx((prev) => (prev === idx ? prev : idx));
  }, []);

  // ── Quick add ──
  const [adding, setAdding] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const activeStatus = TICKET_STATUSES[activeIdx] ?? 'todo';
  const canAdd = !!(selectedBoardId ?? boards[0]?.id);

  const handleCreate = useCallback(async () => {
    const title = newTitle.trim();
    const boardId = selectedBoardId ?? boards[0]?.id;
    if (!title || !boardId || submitting) return;
    setSubmitting(true);
    try {
      await createTicket({ boardId, title, status: activeStatus });
      setNewTitle('');
      setAdding(false);
    } finally {
      setSubmitting(false);
    }
  }, [newTitle, selectedBoardId, boards, activeStatus, submitting, createTicket]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header: board picker + desktop switch */}
      <header className="flex shrink-0 items-center gap-2 border-b border-[var(--theme-border)] px-3 py-2">
        <select
          value={selectedBoardId ?? '__all__'}
          onChange={(e) => selectBoard(e.target.value === '__all__' ? null : e.target.value)}
          className="min-w-0 flex-1 appearance-none rounded-md bg-[var(--theme-bg-secondary)] px-3 py-2 text-sm font-semibold text-[var(--theme-text-primary)]"
        >
          {boards.length > 1 && <option value="__all__">Tous les boards</option>}
          {boards.map((b) => (
            <option key={b.id} value={b.id}>
              {b.emoji ? `${b.emoji} ` : ''}{b.name}
            </option>
          ))}
        </select>
        <button
          onClick={() => setMobileOverride('desktop')}
          className="shrink-0 rounded-md px-2 py-2 text-xs text-[var(--theme-text-muted)]"
          title="Passer en vue desktop"
        >
          Desktop
        </button>
      </header>

      {/* Status chips */}
      <nav className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        {(TICKET_STATUSES as readonly TicketStatus[]).map((status, idx) => {
          const count = columns[status]?.length ?? 0;
          const active = idx === activeIdx;
          return (
            <button
              key={status}
              onClick={() => goToColumn(idx)}
              className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                active
                  ? 'bg-[var(--theme-accent)] text-white'
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

      {/* Swipeable columns */}
      <div
        ref={scrollerRef}
        onScroll={handleScroll}
        className="flex min-h-0 flex-1 snap-x snap-mandatory overflow-x-auto overflow-y-hidden [scrollbar-width:none]"
      >
        {(TICKET_STATUSES as readonly TicketStatus[]).map((status) => {
          const tickets = columns[status] ?? [];
          return (
            <div
              key={status}
              className="flex h-full w-full flex-none snap-center flex-col overflow-y-auto px-3 pb-20"
            >
              {tickets.length === 0 ? (
                <p className="py-10 text-center text-sm text-[var(--theme-text-faint)]">
                  Aucun ticket
                </p>
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

      {/* Quick add */}
      {canAdd && !adding && (
        <button
          onClick={() => setAdding(true)}
          className="fixed bottom-5 right-4 z-30 flex h-13 w-13 items-center justify-center rounded-full bg-[var(--theme-accent)] text-2xl leading-none text-white shadow-lg"
          style={{ width: 52, height: 52, marginBottom: 'env(safe-area-inset-bottom)' }}
          aria-label="Nouveau ticket"
        >
          +
        </button>
      )}
      {adding && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/50" onClick={() => setAdding(false)}>
          <div
            className="w-full rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
            style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="mb-2 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
              Nouveau ticket · {TICKET_STATUS_LABELS[activeStatus]}
            </p>
            <textarea
              autoFocus
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleCreate();
                }
              }}
              placeholder="Titre du ticket…"
              rows={2}
              className="w-full resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-3 text-base text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => setAdding(false)}
                className="rounded-lg px-4 py-2 text-sm text-[var(--theme-text-muted)]"
              >
                Annuler
              </button>
              <button
                onClick={handleCreate}
                disabled={!newTitle.trim() || submitting}
                className="rounded-lg bg-[var(--theme-accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                Créer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

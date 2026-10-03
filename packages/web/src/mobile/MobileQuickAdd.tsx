import { useMemo, useState } from 'react';
import { TICKET_STATUS_LABELS } from '@fleex/shared';
import type { Ticket, TicketStatus } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { MobileSheet } from './MobileSheet';

/** Round "+" button shared by Kanban and Tasks, above the floating bar. */
export function QuickAddFab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Nouveau ticket"
      className="fixed right-4 z-20 flex items-center justify-center rounded-full bg-[var(--theme-accent)] text-2xl leading-none text-[var(--theme-accent-fg)] shadow-lg"
      style={{ width: 52, height: 52, bottom: 104 }}
    >
      +
    </button>
  );
}

/**
 * Quick-add sheet shared by Kanban and Tasks: title (first line) + optional
 * description, and the board when there are several. The caller decides the
 * status the ticket lands in and what happens next.
 */
export function QuickAddSheet({
  status,
  defaultBoardId,
  onClose,
  onCreated,
}: {
  status: TicketStatus;
  defaultBoardId: string | null;
  onClose: () => void;
  onCreated?: (ticket: Ticket) => void;
}) {
  const rawBoards = useTicketStore((s) => s.boards);
  const createTicket = useTicketStore((s) => s.createTicket);
  const boards = useMemo(() => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)), [rawBoards]);
  const [boardId, setBoardId] = useState<string | null>(defaultBoardId ?? boards[0]?.id ?? null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const [first = '', ...rest] = text.trim().split('\n');
    const title = first.trim();
    if (!title || !boardId || busy) return;
    setBusy(true);
    try {
      const t = await createTicket({
        boardId,
        title,
        description: rest.join('\n').trim() || undefined,
        status,
      });
      onClose();
      onCreated?.(t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <MobileSheet title={`Nouveau ticket · ${TICKET_STATUS_LABELS[status]}`} onClose={onClose}>
      <textarea
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder="Titre du ticket… (Maj+Entrée pour ajouter une description)"
        rows={3}
        className="w-full resize-none rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] p-3 text-base text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
      />
      {boards.length > 1 && (
        <div className="mt-3 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {boards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => setBoardId(b.id)}
              className={cn(
                'min-h-9 shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium',
                b.id === boardId
                  ? 'bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                  : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]',
              )}
            >
              {b.emoji} {b.name}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-11 rounded-lg px-4 text-sm text-[var(--theme-text-muted)]">
          Annuler
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!text.trim() || !boardId || busy}
          className="min-h-11 rounded-lg bg-[var(--theme-accent)] px-4 text-sm font-medium text-[var(--theme-accent-fg)] disabled:opacity-50"
        >
          Créer
        </button>
      </div>
    </MobileSheet>
  );
}

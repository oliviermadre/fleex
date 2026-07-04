import { useMemo, useState } from 'react';
import { TICKET_PRIORITIES, TICKET_TYPES } from '@fleex/shared';
import type { Ticket, TicketPriority, TicketType } from '@fleex/shared';
import { useTicketStore } from '../stores/ticketStore';

/**
 * Bottom sheet for every ticket-level write the desktop meta sidebar offers:
 * priority, type, tags, due date, favorite, blocked, board move, archive and
 * delete. Field edits go through the standard updateTicket PATCH.
 */
export function MobileTicketMeta({ ticket, onClose }: { ticket: Ticket; onClose: () => void }) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const archiveTicket = useTicketStore((s) => s.archiveTicket);
  const deleteTicket = useTicketStore((s) => s.deleteTicket);
  const rawBoards = useTicketStore((s) => s.boards);
  const boards = useMemo(() => [...rawBoards].sort((a, b) => a.name.localeCompare(b.name)), [rawBoards]);

  const [newTag, setNewTag] = useState('');
  const [confirm, setConfirm] = useState<'archive' | 'delete' | null>(null);

  const patch = (req: Parameters<typeof updateTicket>[1]) => {
    updateTicket(ticket.id, req).catch(() => {});
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag || ticket.tags.includes(tag)) return;
    patch({ tags: [...ticket.tags, tag] });
    setNewTag('');
  };

  const confirmable = (kind: 'archive' | 'delete', run: () => Promise<void>) => {
    if (confirm !== kind) {
      setConfirm(kind);
      setTimeout(() => setConfirm((c) => (c === kind ? null : c)), 2500);
      return;
    }
    setConfirm(null);
    run().then(onClose).catch(() => {});
  };

  const label = 'mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]';
  const select = 'w-full appearance-none rounded-lg bg-[var(--theme-bg-secondary)] px-3 py-2.5 text-sm text-[var(--theme-text-primary)]';

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/60" onClick={onClose}>
      <div
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl border-t border-[var(--theme-border)] bg-[var(--theme-bg-base)] p-4"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 16px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-[var(--theme-text-muted)]">
          Détails du ticket #{ticket.displayId}
        </p>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Priorité</label>
            <select
              value={ticket.priority}
              onChange={(e) => patch({ priority: e.target.value as TicketPriority })}
              className={select}
            >
              {(TICKET_PRIORITIES as readonly TicketPriority[]).map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={label}>Type</label>
            <select
              value={ticket.type ?? ''}
              onChange={(e) => patch({ type: (e.target.value || null) as TicketType | null })}
              className={select}
            >
              <option value="">—</option>
              {(TICKET_TYPES as readonly TicketType[]).map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-2">
          <div>
            <label className={label}>Échéance</label>
            <input
              type="date"
              value={ticket.dueDate ? ticket.dueDate.slice(0, 10) : ''}
              onChange={(e) => patch({ dueDate: e.target.value || null })}
              className={select}
            />
          </div>
          <div>
            <label className={label}>Board</label>
            <select
              value={ticket.boardId}
              onChange={(e) => patch({ boardId: e.target.value })}
              className={select}
            >
              {boards.map((b) => (
                <option key={b.id} value={b.id}>{b.emoji ? `${b.emoji} ` : ''}{b.name}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Toggles */}
        <div className="mb-3 flex gap-2">
          <button
            onClick={() => patch({ favorite: !ticket.favorite })}
            className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ${
              ticket.favorite
                ? 'border-amber-400/40 bg-amber-500/15 text-amber-400'
                : 'border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
            }`}
          >
            ★ Favori
          </button>
          <button
            onClick={() => patch({ blocked: !ticket.blocked })}
            className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ${
              ticket.blocked
                ? 'border-red-400/40 bg-red-500/15 text-red-400'
                : 'border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]'
            }`}
          >
            ⛔ Bloqué
          </button>
        </div>

        {/* Tags */}
        <label className={label}>Tags</label>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ticket.tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-[var(--theme-bg-secondary)] py-1 pl-2.5 pr-1 text-[11px] text-[var(--theme-text-secondary)]"
            >
              {tag}
              <button
                onClick={() => patch({ tags: ticket.tags.filter((t) => t !== tag) })}
                className="flex h-5 w-5 items-center justify-center rounded-full text-[var(--theme-text-faint)]"
                aria-label={`Retirer le tag ${tag}`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
        <div className="mb-4 flex gap-2">
          <input
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addTag();
              }
            }}
            placeholder="Ajouter un tag…"
            className="min-w-0 flex-1 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-secondary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]"
          />
          <button
            onClick={addTag}
            disabled={!newTag.trim()}
            className="shrink-0 rounded-lg bg-[var(--theme-bg-secondary)] px-3 py-2 text-sm text-[var(--theme-text-primary)] disabled:opacity-50"
          >
            +
          </button>
        </div>

        {/* Danger zone */}
        <div className="flex gap-2 border-t border-[var(--theme-border)] pt-3">
          <button
            onClick={() => confirmable('archive', () => archiveTicket(ticket.id))}
            className={`flex-1 rounded-lg border border-[var(--theme-border)] px-3 py-2.5 text-sm font-medium ${
              confirm === 'archive' ? 'bg-amber-500/15 text-amber-400' : 'text-[var(--theme-text-muted)]'
            }`}
          >
            {confirm === 'archive' ? 'Confirmer l’archivage ?' : 'Archiver'}
          </button>
          <button
            onClick={() => confirmable('delete', () => deleteTicket(ticket.id))}
            className={`flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium ${
              confirm === 'delete'
                ? 'border-red-400/40 bg-red-500/15 text-red-400'
                : 'border-[var(--theme-border)] text-red-400/80'
            }`}
          >
            {confirm === 'delete' ? 'Confirmer la suppression ?' : 'Supprimer'}
          </button>
        </div>
      </div>
    </div>
  );
}

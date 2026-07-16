import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Ticket, TicketDeliverable } from '@fleex/shared';
import * as api from '../../services/api';
import { useToastStore } from '../../stores/toastStore';
import { STATUS_COLORS } from '../../lib/statusColors';

interface TicketPickerModalProps {
  open: boolean;
  onClose: () => void;
  deliverable: TicketDeliverable;
  sourceTicketId: string;
}

const FOCUS_DELAY_MS = 50;      // let the modal finish opening before focusing input
const SEARCH_DEBOUNCE_MS = 300; // debounce search input to avoid excessive API calls

const OPEN_STATUSES = new Set(['backlog', 'todo', 'doing', 'reviewing']);

export function TicketPickerModal({ open, onClose, deliverable, sourceTicketId }: TicketPickerModalProps) {
  const [query, setQuery] = useState('');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [copying, setCopying] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Load open tickets
  const loadTickets = useCallback(async (q: string) => {
    setLoading(true);
    try {
      const all = await api.fetchTickets();
      const filtered = all.filter((t) => {
        if (t.id === sourceTicketId) return false;
        if (!OPEN_STATUSES.has(t.status)) return false;
        if (q.trim()) {
          const lq = q.toLowerCase();
          return t.title.toLowerCase().includes(lq) || String(t.displayId).includes(lq);
        }
        return true;
      });
      setTickets(filtered.slice(0, 20));
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [sourceTicketId]);

  // Initial load
  useEffect(() => {
    if (open) {
      loadTickets('');
      setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    } else {
      setQuery('');
      setTickets([]);
    }
  }, [open, loadTickets]);

  // Debounced search
  useEffect(() => {
    if (!open) return;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadTickets(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(debounceRef.current);
  }, [query, open, loadTickets]);

  const handleCopy = useCallback(async (targetTicket: Ticket) => {
    setCopying(targetTicket.id);
    try {
      await api.createDeliverable(targetTicket.id, {
        title: deliverable.title,
        type: deliverable.type,
        content: deliverable.content,
        status: deliverable.status,
        agentName: 'user',
      });
      useToastStore.getState().addToast('success', `Copied to #${targetTicket.displayId} ${targetTicket.title}`);
      onClose();
    } catch {
      // error toast handled by api.ts
    } finally {
      setCopying(null);
    }
  }, [deliverable, onClose]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, onClose]);

  if (!open) return null;

  const statusColor = (status: string) => {
    return STATUS_COLORS[status]?.text ?? 'text-[var(--theme-text-faint)]';
  };

  return createPortal(
    <div
      ref={backdropRef}
      data-overlay-top
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onMouseDown={(e) => {
        if (e.target === backdropRef.current) onClose();
      }}
    >
      <div
        className="flex w-full max-w-md flex-col rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--theme-border)] px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold text-[var(--theme-text-primary)]">Copy to ticket</span>
            <span className="truncate text-[10px] text-[var(--theme-text-faint)]">
              {deliverable.title}
            </span>
          </div>
          <button
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-danger)]/15 hover:text-[var(--theme-danger)]"
          >
            &times;
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--theme-border)] px-4 py-2">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search open tickets..."
            className="w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-input)] px-3 py-1.5 text-sm text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] outline-none transition-colors focus:border-[var(--theme-accent)]"
          />
        </div>

        {/* Ticket list */}
        <div className="max-h-72 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-xs text-[var(--theme-text-faint)]">Loading...</span>
            </div>
          ) : tickets.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <span className="text-xs text-[var(--theme-text-faint)]">No open tickets match your search</span>
            </div>
          ) : (
            tickets.map((t) => (
              <button
                key={t.id}
                onClick={() => handleCopy(t)}
                disabled={copying !== null}
                className="flex w-full items-center gap-3 border-b border-[var(--theme-border)]/50 px-4 py-2.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)] disabled:opacity-50 last:border-b-0"
              >
                <span className="flex-shrink-0 text-[10px] font-mono text-[var(--theme-text-faint)]">
                  #{t.displayId}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--theme-text-primary)]">
                  {t.title}
                </span>
                <span className={`flex-shrink-0 text-[10px] font-medium uppercase tracking-wider ${statusColor(t.status)}`}>
                  {t.status}
                </span>
                {copying === t.id && (
                  <span className="flex-shrink-0 text-[10px] text-[var(--theme-accent)]">Copying...</span>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { Ticket } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useClickOutside } from '../../hooks/useClickOutside';
import { DueDateBadge } from './DueDateBadge';

function formatDateInputValue(isoString: string | null): string {
  if (!isoString) return '';
  // Extract YYYY-MM-DD portion from ISO string, interpreting as local date
  const d = new Date(isoString);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToISO(value: string): string {
  // Use noon local time to avoid UTC day-shift issues
  return new Date(`${value}T12:00:00`).toISOString();
}

function getTodayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getEndOfWeekDateString(): string {
  const d = new Date();
  const jsDay = d.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToFriday = 4 - ((jsDay + 6) % 7);
  d.setDate(d.getDate() + daysToFriday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DueDatePickerPopover({ ticket }: { ticket: Ticket }) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useClickOutside([triggerRef, menuRef], () => setOpen(false), open);

  const rect = triggerRef.current?.getBoundingClientRect();

  const handleDateChange = (value: string) => {
    if (value) {
      updateTicket(ticket.id, { dueDate: dateInputToISO(value) });
    }
    setOpen(false);
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    updateTicket(ticket.id, { dueDate: null });
    setOpen(false);
  };

  return (
    <>
      <button
        ref={triggerRef}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-xs transition-colors hover:bg-[var(--theme-bg-hover)] text-[var(--theme-text-secondary)]"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        title={ticket.dueDate ? 'Changer la due date' : 'Définir une due date'}
      >
        {/* Calendar icon */}
        <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0 text-[var(--theme-text-faint)]">
          <rect x="1.5" y="2.5" width="13" height="12" rx="1.5" />
          <line x1="1.5" y1="6.5" x2="14.5" y2="6.5" />
          <line x1="5" y1="1" x2="5" y2="4" />
          <line x1="11" y1="1" x2="11" y2="4" />
        </svg>
        {ticket.dueDate ? (
          <DueDateBadge dueDate={ticket.dueDate} status={ticket.status} size="md" />
        ) : (
          <span className="text-[var(--theme-text-faint)]">Aucune</span>
        )}
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3 shadow-xl"
          style={{ left: rect.left, top: rect.bottom + 4 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">
            Due date
          </div>
          <div className="mb-2 flex gap-2">
            <button
              className="flex-1 rounded-md border border-[var(--theme-border-input)] px-2 py-1.5 text-xs text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => handleDateChange(getTodayDateString())}
            >
              Aujourd'hui
            </button>
            <button
              className="flex-1 rounded-md border border-[var(--theme-border-input)] px-2 py-1.5 text-xs text-[var(--theme-text-primary)] transition-colors hover:bg-[var(--theme-bg-hover)]"
              onClick={() => handleDateChange(getEndOfWeekDateString())}
            >
              Ven.
            </button>
          </div>
          <input
            type="date"
            className="block w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-2 py-1.5 text-xs text-[var(--theme-text-primary)] focus:border-[var(--theme-accent)] focus:outline-none"
            value={formatDateInputValue(ticket.dueDate)}
            onChange={(e) => handleDateChange(e.target.value)}
          />
          {ticket.dueDate && (
            <button
              className="mt-2 w-full rounded-md px-2 py-1 text-xs text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-danger,#ef4444)]"
              onClick={handleClear}
            >
              Effacer
            </button>
          )}
        </div>,
        document.body,
      )}
    </>
  );
}

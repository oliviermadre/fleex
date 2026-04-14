import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Ticket, TicketPriority } from '@fleex/shared';
import { PriorityIndicator } from './PriorityIndicator';
import { useTicketStore } from '../../stores/ticketStore';
import { cn } from '../../lib/cn';

const PRIORITIES: TicketPriority[] = ['high', 'medium', 'low', 'none'];

const PRIORITY_LABELS: Record<TicketPriority, string> = {
  none: 'None',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export function PriorityPickerPopover({ ticket }: { ticket: Ticket }) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handleMouseDown(e: MouseEvent) {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const rect = triggerRef.current?.getBoundingClientRect();

  return (
    <>
      <button
        ref={triggerRef}
        className="cursor-pointer rounded p-0.5 transition-opacity hover:opacity-70 focus:outline-none"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        title={`Priority: ${PRIORITY_LABELS[ticket.priority]} — click to change`}
      >
        <PriorityIndicator priority={ticket.priority} size="md" />
      </button>

      {open && rect && createPortal(
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[110px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          style={{ left: rect.left, top: rect.bottom + 4 }}
        >
          {PRIORITIES.map((p) => (
            <button
              key={p}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]',
                p === ticket.priority
                  ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]'
                  : 'text-[var(--theme-text-secondary)]',
              )}
              onClick={(e) => {
                e.stopPropagation();
                updateTicket(ticket.id, { priority: p });
                setOpen(false);
              }}
            >
              <PriorityIndicator priority={p} size="sm" />
              {PRIORITY_LABELS[p]}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

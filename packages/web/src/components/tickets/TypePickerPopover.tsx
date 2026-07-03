import type { Ticket, TicketType } from '@fleex/shared';
import { TICKET_TYPE_LABELS } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';
import { TYPE_COLORS } from './TicketTypeBadge';

const TYPES: (TicketType | null)[] = ['build', 'fix', 'review', 'ops', 'lead', 'think', null];

const TYPE_DESCRIPTIONS: Record<TicketType, string> = {
  build: 'New feature or capability',
  fix: 'Bug fix or correction',
  review: 'Code review, QA, audit',
  ops: 'Infra, CI/CD, tooling, config',
  lead: 'Management, coordination, decisions',
  think: 'Research, exploration, design',
};

export function TypePickerPopover({ ticket }: { ticket: Ticket }) {
  const updateTicket = useTicketStore((s) => s.updateTicket);
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();

  return (
    <>
      <button
        ref={refs.setReference}
        className={cn(
          'cursor-pointer rounded px-0.5 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-70 focus:outline-none',
          ticket.type ? TYPE_COLORS[ticket.type] : 'text-[var(--theme-text-faint)]',
        )}
        {...getReferenceProps({ onClick: (e) => e.stopPropagation() })}
        title="Click to change type"
      >
        {ticket.type ? TICKET_TYPE_LABELS[ticket.type] : 'Task'}
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[200px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            {TYPES.map((t) => (
              <button
                key={t ?? '__none'}
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)]',
                  t === ticket.type
                    ? 'bg-[var(--theme-bg-hover)]'
                    : '',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  updateTicket(ticket.id, { type: t });
                  setOpen(false);
                }}
              >
                <span className={cn('text-xs font-medium', t ? TYPE_COLORS[t] : 'text-[var(--theme-text-secondary)]')}>
                  {t ? TICKET_TYPE_LABELS[t] : 'Task'}
                </span>
                <span className="text-[10px] text-[var(--theme-text-faint)]">
                  {t ? TYPE_DESCRIPTIONS[t] : 'No specific type'}
                </span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

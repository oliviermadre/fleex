/**
 * Value+onChange type picker for the new-task draft, visually identical to the
 * Context type picker (TypePickerPopover) — same colours, labels and
 * descriptions — but bound to a draft value rather than a persisted ticket.
 */
import type { TicketType } from '@fleex/shared';
import { TICKET_TYPE_LABELS } from '@fleex/shared';
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import { TYPE_COLORS } from '../../tickets/TicketTypeBadge';

const TYPES: TicketType[] = ['build', 'fix', 'review', 'ops', 'lead', 'think'];

const TYPE_DESCRIPTIONS: Record<TicketType, string> = {
  build: 'New feature or capability',
  fix: 'Bug fix or correction',
  review: 'Code review, QA, audit',
  ops: 'Infra, CI/CD, tooling, config',
  lead: 'Management, coordination, decisions',
  think: 'Research, exploration, design',
};

export function DraftTypePicker({ value, onChange }: { value: TicketType; onChange: (t: TicketType) => void }) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        className={cn(
          'cursor-pointer rounded px-0.5 py-0.5 text-[12px] font-medium transition-opacity hover:opacity-70 focus:outline-none',
          TYPE_COLORS[value],
        )}
        title="Click to change type"
      >
        {TICKET_TYPE_LABELS[value]}
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
                key={t}
                type="button"
                className={cn(
                  'flex w-full flex-col gap-0.5 px-3 py-1.5 text-left transition-colors hover:bg-[var(--theme-bg-hover)]',
                  t === value ? 'bg-[var(--theme-bg-hover)]' : '',
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(t);
                  setOpen(false);
                }}
              >
                <span className={cn('text-xs font-medium', TYPE_COLORS[t])}>{TICKET_TYPE_LABELS[t]}</span>
                <span className="text-[10px] text-[var(--theme-text-faint)]">{TYPE_DESCRIPTIONS[t]}</span>
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

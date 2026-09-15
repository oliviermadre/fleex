/**
 * The queue's "group by" dropdown: a compact trigger showing the current
 * grouping that opens a single-select popover. Same design language as the
 * MultiSelect / picker popovers.
 */
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import type { QueueGroupBy } from '../../../stores/workStore';

interface Props {
  value: QueueGroupBy;
  onChange: (v: QueueGroupBy) => void;
  options: { value: QueueGroupBy; label: string }[];
}

export function GroupBySelect({ value, onChange, options }: Props) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();
  const current = options.find((o) => o.value === value);

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        title="Group tasks by"
        className="inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)]"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2.5" y1="4" x2="13.5" y2="4" />
          <line x1="2.5" y1="8" x2="13.5" y2="8" />
          <line x1="2.5" y1="12" x2="9" y2="12" />
        </svg>
        <span>{current?.label ?? 'Group'}</span>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 min-w-[160px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            <div className="px-3 pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">
              Group by
            </div>
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--theme-bg-hover)]',
                  o.value === value ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

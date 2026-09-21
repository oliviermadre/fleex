import { Fragment, useMemo, useState } from 'react';
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import type { MultiSelectOption } from '../../ui/MultiSelect';
import { cn } from '../../../lib/cn';

/**
 * Pick ONE repo. The single-select sibling of `MultiSelect`: same popover, same
 * filter field, same grouped options ("Suggested" for the board, then the rest),
 * but the trigger names the repo and choosing closes the list.
 */
export function RepoPicker({
  value,
  options,
  onChange,
  onOpenChange,
}: {
  value: string;
  options: readonly MultiSelectOption<string>[];
  onChange: (repoKey: string) => void;
  /** Lets the host screen know the list owns `Esc` while it is open. */
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpenState] = useState(false);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    onOpenChange?.(next);
    if (!next) setQuery('');
  };
  const { refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    role: 'listbox',
    open,
    onOpenChange: setOpen,
  });
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  function choose(repoKey: string) {
    onChange(repoKey);
    setOpen(false);
  }

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        aria-label="Repository"
        className="inline-flex h-full max-w-[16rem] shrink-0 cursor-pointer items-center gap-2 rounded-[9px] border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 font-mono text-[12.5px] text-[var(--theme-text-primary)] transition-colors hover:border-[var(--theme-text-muted)] focus-visible:border-[var(--theme-accent)] focus-visible:outline-none"
      >
        <span className="truncate">{value || 'Pick a repo…'}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" className="shrink-0 text-[var(--theme-text-muted)]" aria-hidden>
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[300px] overflow-hidden rounded-[10px] border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] pb-1 shadow-xl"
          >
            <div className="border-b border-[var(--theme-border)] p-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filtered[0]) {
                    e.preventDefault();
                    choose(filtered[0].value);
                  }
                }}
                placeholder="Filter repos…"
                className="h-8 w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-2.5 text-[12.5px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-[var(--theme-text-muted)]">No repo matches “{query}”.</div>
              )}
              {filtered.map((option, i) => (
                <Fragment key={option.value}>
                  {option.group && option.group !== filtered[i - 1]?.group && (
                    <div className="px-3 pb-1 pt-2 font-mono text-[9.5px] font-medium uppercase tracking-[0.16em] text-[var(--theme-text-muted)]">
                      {option.group}
                    </div>
                  )}
                  <button
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    onClick={() => choose(option.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left font-mono text-[12.5px] transition-colors hover:bg-[var(--theme-accent-muted)] hover:text-[var(--theme-text-primary)]',
                      option.value === value ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]',
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {option.value === value && <span className="text-[var(--theme-accent)]">✓</span>}
                  </button>
                </Fragment>
              ))}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

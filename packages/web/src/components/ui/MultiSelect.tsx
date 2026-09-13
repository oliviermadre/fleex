/**
 * MultiSelect — a reusable checkbox multi-select in the app's popover design
 * language (SmartSessionButton: portal popover, sticky search, hoverable rows).
 * Generic over the option value type so it fits boards, priorities, repos, etc.
 *
 * Selection semantics: an empty `values` array means "all" (no filter). The
 * trigger shows the active count, or `allLabel` when nothing is selected. The
 * menu stays open across toggles so several options can be picked at once.
 */
import { useMemo, useState } from 'react';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

export interface MultiSelectOption<V extends string> {
  value: V;
  label: string;
  icon?: React.ReactNode;
}

interface Props<V extends string> {
  /** Short noun shown on the trigger, e.g. "Boards". */
  label: string;
  /** Trigger text when nothing is selected (means "all"). Defaults to `All ${label}`. */
  allLabel?: string;
  values: readonly V[];
  options: readonly MultiSelectOption<V>[];
  onChange: (values: V[]) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  className?: string;
}

export function MultiSelect<V extends string>({
  label,
  allLabel,
  values,
  options,
  onChange,
  searchable = true,
  searchPlaceholder = 'Filter…',
  className,
}: Props<V>) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover();
  const [query, setQuery] = useState('');
  const selected = new Set(values);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  function toggle(v: V) {
    if (selected.has(v)) onChange(values.filter((x) => x !== v));
    else onChange([...values, v]);
  }

  const triggerText =
    values.length === 0 ? (allLabel ?? `All ${label.toLowerCase()}`) : `${label} · ${values.length}`;

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
          values.length > 0
            ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
            : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
          className,
        )}
      >
        <span className="truncate">{triggerText}</span>
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" className="shrink-0">
          <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[220px] overflow-hidden rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] pb-1 shadow-xl"
          >
            {searchable && (
              <div className="sticky top-0 z-[2] border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-2">
                <div className="relative flex items-center">
                  <svg
                    className="absolute left-2 text-[var(--theme-text-faint)]"
                    width="13"
                    height="13"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="7" cy="7" r="5" />
                    <line x1="10.5" y1="10.5" x2="14" y2="14" />
                  </svg>
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder={searchPlaceholder}
                    className="h-7 w-full rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] pl-7 pr-2 text-[11px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
                  />
                </div>
              </div>
            )}

            <div className="max-h-64 overflow-y-auto py-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onChange([]);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--theme-bg-hover)]"
              >
                <Checkbox checked={values.length === 0} />
                <span className={values.length === 0 ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-secondary)]'}>
                  {allLabel ?? `All ${label.toLowerCase()}`}
                </span>
              </button>

              {filtered.map((o) => {
                const isOn = selected.has(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(o.value);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[var(--theme-bg-hover)]"
                  >
                    <Checkbox checked={isOn} />
                    {o.icon}
                    <span className={cn('truncate', isOn ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]')}>
                      {o.label}
                    </span>
                  </button>
                );
              })}

              {filtered.length === 0 && (
                <div className="px-3 py-2 text-[11px] text-[var(--theme-text-faint)]">No match.</div>
              )}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

function Checkbox({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
        checked
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
          : 'border-[var(--theme-border-input)]',
      )}
    >
      {checked && (
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M3 8l3.5 3.5L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

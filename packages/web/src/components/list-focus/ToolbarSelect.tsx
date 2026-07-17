import type { ReactNode } from 'react';
import { usePopover, FloatingPortal } from '../../hooks/usePopover';
import { cn } from '../../lib/cn';

/**
 * Cockpit toolbar dropdowns (#400, review pass 3, remark 1). Same popover
 * recipe as the kanban dropdowns (BoardSelectorDropdown / FilterDropdown):
 * usePopover + FloatingPortal, rounded-lg surface menu, icon + label rows,
 * accent highlight on the active entry — replacing the native <select>s.
 */

export interface ToolbarOption<V extends string> {
  value: V;
  label: string;
  /** Board emoji, type emoji, priority picto, status dot… (remark 1). */
  icon?: ReactNode;
}

function Chevron() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-[var(--theme-text-muted)]"
    >
      <polyline points="4 6 8 10 12 6" />
    </svg>
  );
}

const TRIGGER_CLASS =
  'flex items-center gap-1.5 rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 py-1 text-xs transition-colors hover:bg-[var(--theme-bg-hover)]';

const MENU_CLASS =
  'z-50 min-w-[160px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl';

const ITEM_CLASS =
  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-[var(--theme-bg-hover)]';

interface ToolbarSelectProps<V extends string> {
  /** Trigger + first menu entry when no value is selected, e.g. "All boards". */
  allLabel: string;
  value: V | null;
  options: ToolbarOption<V>[];
  onChange: (value: V | null) => void;
}

/** Single-select filter: one value or "All" (null). */
export function ToolbarSelect<V extends string>({
  allLabel,
  value,
  options,
  onChange,
}: ToolbarSelectProps<V>) {
  const { open, setOpen, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-start',
  });
  const selected = value ? options.find((o) => o.value === value) ?? null : null;

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          TRIGGER_CLASS,
          selected ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
          open && 'bg-[var(--theme-bg-hover)]',
        )}
        {...getReferenceProps()}
      >
        {selected ? (
          <>
            {selected.icon}
            <span className="font-medium">{selected.label}</span>
          </>
        ) : (
          <span>{allLabel}</span>
        )}
        <Chevron />
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={MENU_CLASS}
          >
            <button
              type="button"
              className={cn(
                ITEM_CLASS,
                value === null
                  ? 'bg-[var(--theme-accent)]/10 font-medium text-[var(--theme-accent)]'
                  : 'text-[var(--theme-text-secondary)]',
              )}
              onClick={() => {
                onChange(null);
                setOpen(false);
              }}
            >
              {allLabel}
            </button>
            <div className="my-1 border-t border-[var(--theme-border-subtle)]" />
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                className={cn(
                  ITEM_CLASS,
                  o.value === value
                    ? 'bg-[var(--theme-accent)]/10 font-medium text-[var(--theme-accent)]'
                    : 'text-[var(--theme-text-secondary)]',
                )}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.icon && <span className="flex w-4 shrink-0 items-center justify-center">{o.icon}</span>}
                {o.label}
              </button>
            ))}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

interface ToolbarMultiSelectProps<V extends string> {
  /** Trigger label, e.g. "Status" — the count of selected values sits next to it. */
  label: string;
  values: readonly V[];
  options: ToolbarOption<V>[];
  onToggle: (value: V) => void;
}

/**
 * Multi-select filter (status scope, remark 1): the menu stays open across
 * toggles so several statuses can be picked without reopening.
 */
export function ToolbarMultiSelect<V extends string>({
  label,
  values,
  options,
  onToggle,
}: ToolbarMultiSelectProps<V>) {
  const { open, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({
    placement: 'bottom-start',
  });

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        className={cn(
          TRIGGER_CLASS,
          values.length > 0 ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
          open && 'bg-[var(--theme-bg-hover)]',
        )}
        {...getReferenceProps()}
      >
        <span className="font-medium">{label}</span>
        <span className="rounded-full bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--theme-text-muted)]">
          {values.length}
        </span>
        <Chevron />
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className={MENU_CLASS}
          >
            {options.map((o) => {
              const checked = values.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  className={cn(
                    ITEM_CLASS,
                    checked
                      ? 'font-medium text-[var(--theme-text-primary)]'
                      : 'text-[var(--theme-text-muted)]',
                  )}
                  onClick={() => onToggle(o.value)}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border',
                      checked
                        ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'
                        : 'border-[var(--theme-border)]',
                    )}
                  >
                    {checked && (
                      <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="3,8 6.5,12 13,4" />
                      </svg>
                    )}
                  </span>
                  {o.icon && <span className="flex w-4 shrink-0 items-center justify-center">{o.icon}</span>}
                  {o.label}
                </button>
              );
            })}
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

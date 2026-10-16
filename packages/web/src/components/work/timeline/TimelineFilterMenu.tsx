/**
 * The Timeline's category filters behind a funnel button (spec v2 §3.1–3.2), so
 * the fixed column keeps its height for the « Temps » block. A badge counts the
 * hidden categories; the popover (portal, so the drawer never clips it) toggles
 * them immediately and stays open; Esc / outside click / the button close it.
 */
import { useState } from 'react';
import {
  FloatingFocusManager,
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useRole,
} from '@floating-ui/react';
import { cn } from '../../../lib/cn';
import type { TimelineFilterKey } from '../../../stores/workStore';
import type { TimelineFilters } from './layoutTimeline';

export const FILTERS: { key: TimelineFilterKey; label: string }[] = [
  { key: 'status', label: 'Statuts' },
  { key: 'cli', label: 'CLI' },
  { key: 'pr', label: 'PR' },
  { key: 'deliverables', label: 'Livrables' },
  { key: 'comments', label: 'Commentaires' },
  { key: 'annotations', label: 'Annotations' },
];

export function TimelineFilterMenu({
  filters,
  onToggleFilter,
}: {
  filters: TimelineFilters;
  onToggleFilter: (key: TimelineFilterKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const { refs, floatingStyles, context } = useFloating({
    open,
    onOpenChange: setOpen,
    placement: 'bottom-end',
    whileElementsMounted: autoUpdate,
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context);
  const role = useRole(context, { role: 'dialog' });
  const { getReferenceProps, getFloatingProps } = useInteractions([click, dismiss, role]);

  const hidden = FILTERS.filter((f) => !filters[f.key]);
  const label = hidden.length
    ? `Filtres de la timeline (${hidden.length} masqué${hidden.length > 1 ? 's' : ''})`
    : 'Filtres de la timeline';

  return (
    <>
      <button
        ref={refs.setReference}
        type="button"
        aria-label={label}
        title={hidden.length ? `Masqués : ${hidden.map((f) => f.label).join(', ')}` : 'Filtres de la timeline'}
        className={cn(
          'relative grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[5px] border border-transparent transition-colors hover:bg-[var(--theme-bg-hover)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--theme-accent)]',
          open && 'border-[var(--theme-border-input)] bg-[var(--theme-bg-hover)]',
          hidden.length ? 'text-[var(--theme-accent)]' : 'text-[var(--theme-text-muted)]',
        )}
        {...getReferenceProps()}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
          <path d="M2 3h12l-4.6 5.4v4.1L6.6 14V8.4z" />
        </svg>
        {hidden.length > 0 && (
          <span
            aria-hidden
            data-testid="timeline-filter-badge"
            className="absolute -right-1.5 -top-1.5 h-3.5 min-w-3.5 rounded-full border border-[var(--theme-bg-surface)] bg-[var(--theme-accent)] px-[3px] text-center text-[9px] font-semibold leading-[12px] text-white tabular-nums"
          >
            {hidden.length}
          </span>
        )}
      </button>

      {open && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              aria-label="Filtres de la timeline"
              className="z-50 w-[188px] rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-2 text-[12px] shadow-lg"
              {...getFloatingProps()}
            >
              <div className="mb-1 text-[10px] uppercase tracking-wide text-[var(--theme-text-faint)]">Afficher sur la frise</div>
              {FILTERS.map((f) => (
                <label
                  key={f.key}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-[var(--theme-bg-hover)]',
                    filters[f.key] ? 'text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]',
                  )}
                >
                  <input
                    type="checkbox"
                    className="m-0 accent-[var(--theme-accent)]"
                    checked={filters[f.key]}
                    onChange={() => onToggleFilter(f.key)}
                  />
                  {f.label}
                </label>
              ))}
              {hidden.length > 0 && (
                <>
                  <hr className="my-1.5 border-[var(--theme-border)]" />
                  <button
                    type="button"
                    className="px-1 text-[12px] text-[var(--theme-accent)] hover:underline"
                    onClick={() => hidden.forEach((f) => onToggleFilter(f.key))}
                  >
                    Tout afficher
                  </button>
                </>
              )}
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
    </>
  );
}

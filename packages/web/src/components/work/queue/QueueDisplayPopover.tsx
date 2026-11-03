/**
 * The queue's "Display" popover: group by, sub-group by (never the first level)
 * and sort with its direction. Replaces the single "group by" dropdown; options
 * are listed inline in one popover (no nested menus).
 */
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import { DEFAULT_QUEUE_DISPLAY, defaultDirFor, type QueueDisplay, type QueueGroupBy, type QueueSortKey } from '../queueFilters';

export const GROUP_BY_OPTIONS: { value: QueueGroupBy; label: string }[] = [
  { value: 'activity', label: 'Activity' },
  { value: 'status', label: 'Status' },
  { value: 'board', label: 'Board' },
  { value: 'epic', label: 'Epic' },
  { value: 'repo', label: 'Repo' },
  { value: 'type', label: 'Type' },
  { value: 'priority', label: 'Priority' },
];

const SORT_OPTIONS: { value: QueueSortKey; label: string }[] = [
  { value: 'default', label: 'Default' },
  { value: 'lastActivity', label: 'Last activity' },
  { value: 'priority', label: 'Priority' },
  { value: 'created', label: 'Created' },
  { value: 'number', label: 'Number' },
  { value: 'title', label: 'Title' },
];

interface Props {
  display: QueueDisplay;
  onChangeGroupBy: (groupBy: QueueGroupBy) => void;
  onChange: (patch: Partial<QueueDisplay>) => void;
}

function Choice({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        on
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
          : 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {children}
    </button>
  );
}

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 pb-2">
      <div className="pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">{title}</div>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

const labelOf = (g: QueueGroupBy | null) => GROUP_BY_OPTIONS.find((o) => o.value === g)?.label;

export function QueueDisplayPopover({ display, onChangeGroupBy, onChange }: Props) {
  const { open, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ role: 'dialog' });
  const customized =
    display.groupBy !== DEFAULT_QUEUE_DISPLAY.groupBy || display.subGroupBy !== null || display.sort.key !== 'default';
  const triggerLabel = display.subGroupBy ? `${labelOf(display.groupBy)} › ${labelOf(display.subGroupBy)}` : labelOf(display.groupBy);

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        title="Group and sort tasks"
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
          customized ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-muted)]',
          'hover:bg-[var(--theme-bg-hover)]',
        )}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <line x1="2.5" y1="4" x2="13.5" y2="4" />
          <line x1="2.5" y1="8" x2="13.5" y2="8" />
          <line x1="2.5" y1="12" x2="9" y2="12" />
        </svg>
        <span className="max-w-[140px] truncate">{triggerLabel}</span>
        {display.sort.key !== 'default' && <span aria-hidden>{display.sort.dir === 'asc' ? '↑' : '↓'}</span>}
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[280px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            <Row title="Group by">
              {GROUP_BY_OPTIONS.map((o) => (
                <Choice key={o.value} on={display.groupBy === o.value} onClick={() => onChangeGroupBy(o.value)}>
                  {o.label}
                </Choice>
              ))}
            </Row>
            <Row title="Sub-group by">
              <Choice on={display.subGroupBy === null} onClick={() => onChange({ subGroupBy: null })}>
                None
              </Choice>
              {GROUP_BY_OPTIONS.filter((o) => o.value !== display.groupBy).map((o) => (
                <Choice key={o.value} on={display.subGroupBy === o.value} onClick={() => onChange({ subGroupBy: o.value })}>
                  {o.label}
                </Choice>
              ))}
            </Row>
            <Row title="Sort by">
              {SORT_OPTIONS.map((o) => (
                <Choice
                  key={o.value}
                  on={display.sort.key === o.value}
                  onClick={() => onChange({ sort: { key: o.value, dir: defaultDirFor(o.value) } })}
                >
                  {o.label}
                </Choice>
              ))}
              {display.sort.key !== 'default' && (
                <button
                  type="button"
                  aria-label={display.sort.dir === 'asc' ? 'Ascending — switch to descending' : 'Descending — switch to ascending'}
                  title="Direction"
                  onClick={() => onChange({ sort: { ...display.sort, dir: display.sort.dir === 'asc' ? 'desc' : 'asc' } })}
                  className="ml-auto rounded-md border border-[var(--theme-border-input)] px-2 py-0.5 text-[11px] text-[var(--theme-text-primary)] hover:bg-[var(--theme-bg-hover)]"
                >
                  {display.sort.dir === 'asc' ? '↑ Asc' : '↓ Desc'}
                </button>
              )}
            </Row>
            <div className="px-3 pb-1.5 text-[10.5px] text-[var(--theme-text-faint)]">
              {display.sort.key === 'default'
                ? 'Default: needs-you by waiting time, running and idle by recency.'
                : 'Sorted inside each group.'}
            </div>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

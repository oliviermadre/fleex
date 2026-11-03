/**
 * "Filters · n": the queue filters beyond the inline Boards / Status — priority,
 * type, epic, repo, PR, blocked, inactivity. Values are toggle pills inside one
 * popover (no nested menus); "Clear" empties these only.
 */
import { TICKET_TYPES, TICKET_TYPE_EMOJIS, TICKET_TYPE_LABELS, type TicketGroup } from '@fleex/shared';
import { usePopover, FloatingPortal } from '../../../hooks/usePopover';
import { cn } from '../../../lib/cn';
import { PriorityIndicator, PRIORITY_LABELS, PRIORITY_ORDER_DESC } from '../../tickets/PriorityIndicator';
import {
  INACTIVE_FOR_OPTIONS,
  NONE,
  clearPopoverFilters,
  popoverFilterCount,
  type BlockedFilter,
  type InactiveFor,
  type PrFilterValue,
  type QueueFilters,
} from '../queueFilters';

interface Option {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface Props {
  filters: QueueFilters;
  onChange: (patch: Partial<QueueFilters>) => void;
  epics: readonly TicketGroup[];
  /** Repo filter options: lower-cased "org/name" key + label. */
  repos: readonly Option[];
}

const PR_OPTIONS: { value: PrFilterValue; label: string }[] = [
  { value: NONE, label: 'No PR' },
  { value: 'open', label: 'Open' },
  { value: 'draft', label: 'Draft' },
  { value: 'merged', label: 'Merged' },
  { value: 'closed', label: 'Closed' },
];
const BLOCKED_OPTIONS: { value: BlockedFilter; label: string }[] = [
  { value: 'any', label: 'Any' },
  { value: 'blocked', label: 'Blocked' },
  { value: 'not_blocked', label: 'Not blocked' },
];
const INACTIVE_LABELS: Record<InactiveFor, string> = { '1d': '1 d', '3d': '3 d', '7d': '7 d', '14d': '14 d', '30d': '30 d' };

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 pb-2">
      <div className="pb-1 pt-1.5 text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">{title}</div>
      {children}
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors',
        on
          ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
          : 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
      )}
    >
      {children}
    </button>
  );
}

/** A multi-valued filter as toggle pills. */
function PillSet({ values, options, onChange }: { values: readonly string[]; options: readonly Option[]; onChange: (v: string[]) => void }) {
  const toggle = (v: string) => onChange(values.includes(v) ? values.filter((x) => x !== v) : [...values, v]);
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <Pill key={o.value} on={values.includes(o.value)} onClick={() => toggle(o.value)}>
          {o.icon}
          {o.label}
        </Pill>
      ))}
    </div>
  );
}

/** A single-choice filter as a segmented control. */
function Segmented<V extends string>({ value, options, onChange }: { value: V; options: readonly { value: V; label: string }[]; onChange: (v: V) => void }) {
  return (
    <div className="flex overflow-hidden rounded-md border border-[var(--theme-border-input)]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 border-r border-[var(--theme-border-input)] px-1.5 py-1 text-[11px] last:border-r-0 transition-colors',
            o.value === value
              ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
              : 'text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function QueueFiltersPopover({ filters, onChange, epics, repos }: Props) {
  const { open, refs, floatingStyles, getReferenceProps, getFloatingProps } = usePopover({ role: 'dialog', maxHeight: 560 });
  const count = popoverFilterCount(filters);

  // Archived / closed epics only show while selected, so a view keeps showing what it filters on.
  const epicOptions: Option[] = [
    ...epics
      .filter((e) => e.groupStatus === 'active' || filters.epics.includes(e.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ value: e.id, label: e.name, icon: e.emoji ? <span>{e.emoji}</span> : undefined })),
    { value: NONE, label: 'No epic' },
  ];
  const repoOptions: Option[] = [
    ...repos,
    ...filters.repos.filter((r) => r !== NONE && !repos.some((o) => o.value === r)).map((r) => ({ value: r, label: r })),
    { value: NONE, label: 'No repo' },
  ];

  return (
    <>
      <button
        ref={refs.setReference}
        {...getReferenceProps()}
        type="button"
        title="More filters"
        className={cn(
          'inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors',
          count > 0
            ? 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]'
            : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
        )}
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 3h12l-4.5 5.5V13l-3-1.5v-3z" />
        </svg>
        <span>{count > 0 ? `Filters · ${count}` : 'Filters'}</span>
      </button>

      {open && (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-[300px] rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] py-1 shadow-xl"
          >
            <div className="flex items-center px-3 pb-1 pt-1.5">
              <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--theme-text-faint)]">Filters</span>
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => onChange(clearPopoverFilters(filters))}
                  className="ml-auto text-[11px] text-[var(--theme-accent)] hover:underline"
                >
                  Clear
                </button>
              )}
            </div>
            <Section title="Priority">
              <PillSet
                values={filters.priorities}
                onChange={(priorities) => onChange({ priorities })}
                options={PRIORITY_ORDER_DESC.map((p) => ({ value: p, label: PRIORITY_LABELS[p], icon: <PriorityIndicator priority={p} /> }))}
              />
            </Section>
            <Section title="Type">
              <PillSet
                values={filters.types}
                onChange={(types) => onChange({ types })}
                options={[
                  ...TICKET_TYPES.map((t) => ({ value: t, label: TICKET_TYPE_LABELS[t] ?? t, icon: <span>{TICKET_TYPE_EMOJIS[t]}</span> })),
                  { value: NONE, label: 'No type' },
                ]}
              />
            </Section>
            <Section title="Epic">
              <PillSet values={filters.epics} onChange={(e) => onChange({ epics: e })} options={epicOptions} />
            </Section>
            <Section title="Repo">
              <PillSet values={filters.repos} onChange={(r) => onChange({ repos: r })} options={repoOptions} />
            </Section>
            <Section title="Pull request">
              <PillSet values={filters.prs} onChange={(p) => onChange({ prs: p as PrFilterValue[] })} options={PR_OPTIONS} />
            </Section>
            <Section title="Blocked">
              <Segmented value={filters.blocked} options={BLOCKED_OPTIONS} onChange={(blocked) => onChange({ blocked })} />
            </Section>
            <Section title="Inactive for">
              <Segmented<InactiveFor | 'off'>
                value={filters.inactiveFor ?? 'off'}
                options={[{ value: 'off', label: '—' }, ...INACTIVE_FOR_OPTIONS.map((v) => ({ value: v, label: INACTIVE_LABELS[v] }))]}
                onChange={(v) => onChange({ inactiveFor: v === 'off' ? null : v })}
              />
            </Section>
          </div>
        </FloatingPortal>
      )}
    </>
  );
}

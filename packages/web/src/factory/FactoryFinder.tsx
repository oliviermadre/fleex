import { useEffect, useMemo } from 'react';
import { TICKET_TYPE_LABELS, TICKET_TYPES, type TicketPriority, type TicketType } from '@fleex/shared';
import { Input } from '../components/ui/Input';
import { TicketTypeIconSvg } from '../components/tickets/TicketTypeIconSvg';
import { PriorityIndicator, PRIORITY_LABELS, PRIORITY_ORDER_DESC } from '../components/tickets/PriorityIndicator';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { finderActive, finderCount, NO_FINDER, type Finder } from './finder';
import { Star } from './FactoryTicketMeta';
import type { FactoryTicket } from './types';

/** The funnel of the Filters tab. */
export const FunnelIcon = ({ size = 13 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
);

/**
 * The tab on the minimap that opens the filters (picked on `docs/factory/hud-overlay.html`): how many are on, and how
 * many tickets they keep. "/" opens it too.
 */
export function FiltersTab({ finder, found, total, open, onToggle, tabRef, tabProps }: {
  finder: Finder; found: FactoryTicket[] | null; total: number; open: boolean; onToggle: () => void;
  tabRef?: (el: HTMLElement | null) => void; tabProps?: Record<string, unknown>;
}) {
  const n = finderCount(finder) + (finder.q.trim() ? 1 : 0), active = finderActive(finder);
  return (
    <div className="flex items-end gap-2">
      <button ref={tabRef} type="button" {...tabProps} onClick={onToggle} aria-expanded={open} title="Find a ticket and filter the floor ( / )"
        className={cn('flex h-[26px] items-center gap-1.5 rounded-t-lg border border-b-0 border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2.5 text-[11px] font-semibold text-[var(--theme-text-primary)] hover:text-[var(--theme-accent)]', open && 'text-[var(--theme-accent)]')}>
        <FunnelIcon />Filters
        {n > 0 && <span className="rounded-full bg-[var(--theme-accent)] px-1.5 font-mono text-[10px] leading-4 text-[var(--theme-bg-base)]">{n}</span>}
      </button>
      {active && found && <span className="mb-1 font-mono text-[10.5px] text-[var(--theme-text-secondary)] [text-shadow:0_1px_2px_var(--theme-bg-base)]" aria-live="polite">{found.length} of {total} shown</span>}
    </div>
  );
}

const Chip = ({ on, onClick, title, children }: { on: boolean; onClick: () => void; title?: string; children: React.ReactNode }) => (
  <button type="button" aria-pressed={on} onClick={onClick} title={title}
    className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors',
      on ? 'border-[var(--theme-accent)] bg-[var(--theme-accent)] font-semibold text-[var(--theme-bg-base)]' : 'border-[var(--theme-border-input)] text-[var(--theme-text-secondary)] hover:border-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}>
    {children}
  </button>
);
const Group = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="flex flex-col gap-1.5" role="group" aria-label={title}>
    <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-[var(--theme-text-muted)]">{title}</span>
    <div className="flex flex-wrap gap-1.5">{children}</div>
  </div>
);
const flip = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

/**
 * Search and filters for the floor, in the popup the Filters tab opens. Nothing it leaves out disappears: those
 * tickets fade, the ones kept stand out with their name. Enter jumps to the next ticket found; Escape clears the
 * search, then closes.
 */
export function FactoryFinder({ finder, onChange, tickets, found, onJump, inputRef, onClose }: {
  finder: Finder; onChange: (f: Finder) => void; tickets: FactoryTicket[]; found: FactoryTicket[] | null; onJump: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>; onClose?: () => void;
}) {
  const boards = useTicketStore((s) => s.boards), fetchBoards = useTicketStore((s) => s.fetchBoards);
  useEffect(() => { if (boards.length === 0) void fetchBoards().catch(() => {}); }, [boards.length, fetchBoards]);
  /* only the boards that have a ticket on the floor are worth offering, with how many */
  const boardOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of tickets) if (t.info && !t.item) count.set(t.info.boardId, (count.get(t.info.boardId) ?? 0) + 1);
    return [...count].map(([id, n]) => ({ value: id, label: boards.find((b) => b.id === id)?.name ?? 'Unknown board', n })).sort((a, b) => a.label.localeCompare(b.label));
  }, [tickets, boards]);
  const typeOptions = useMemo(() => [
    ...TICKET_TYPES.map((t) => ({ value: t as string, label: TICKET_TYPE_LABELS[t] ?? t, icon: <TicketTypeIconSvg type={t as TicketType} size={12} /> })),
    { value: 'none', label: 'No type', icon: <TicketTypeIconSvg type={null} size={12} /> },
  ], []);
  const priorityOptions = useMemo(() => PRIORITY_ORDER_DESC.map((p) => ({ value: p as string, label: PRIORITY_LABELS[p as TicketPriority], icon: <PriorityIndicator priority={p} /> })), []);
  const set = (patch: Partial<Finder>) => onChange({ ...finder, ...patch });
  const active = finderActive(finder);

  return (
    <div className="flex w-[400px] max-w-[calc(100vw-32px)] flex-col gap-3" role="search" aria-label="Find tickets on the floor">
      <Input ref={inputRef} id="factory-find" type="search" value={finder.q} placeholder="Find a ticket: title, number, tag" aria-label="Find a ticket by title, number or tag" autoComplete="off" autoFocus
        onChange={(e) => set({ q: e.target.value })} className="py-1.5 text-xs"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onJump(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (finder.q) set({ q: '' }); else onClose?.(); } }} />
      {boardOptions.length > 0 && (
        <Group title="Boards">{boardOptions.map((o) => <Chip key={o.value} on={finder.boards.includes(o.value)} onClick={() => set({ boards: flip(finder.boards, o.value) })}>{o.label}<span className="opacity-60">{o.n}</span></Chip>)}</Group>
      )}
      <Group title="Types">{typeOptions.map((o) => <Chip key={o.value} on={finder.types.includes(o.value)} onClick={() => set({ types: flip(finder.types, o.value) })}>{o.icon}{o.label}</Chip>)}</Group>
      <Group title="Priorities">{priorityOptions.map((o) => <Chip key={o.value} on={finder.priorities.includes(o.value)} onClick={() => set({ priorities: flip(finder.priorities, o.value) })}>{o.icon}{o.label}</Chip>)}</Group>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={finder.favorite} onClick={() => set({ favorite: !finder.favorite })} title="Only your favourites"><Star on={finder.favorite} size={11} />Favourites</Chip>
        <Chip on={finder.waiting} onClick={() => set({ waiting: !finder.waiting })} title="Only tickets that wait for you">Waiting for me</Chip>
      </div>
      <div className="flex items-center gap-2 border-t border-[var(--theme-border)] pt-2 text-[11px] text-[var(--theme-text-secondary)]">
        <span aria-live="polite">{active && found ? <><b className="text-[var(--theme-text-primary)]">{found.length}</b> of {tickets.length} shown · Enter jumps to the next</> : `${tickets.length} on the floor`}</span>
        <span className="flex-1" />
        {active && <button type="button" className="hover:text-[var(--theme-text-primary)]" onClick={() => onChange(NO_FINDER)} title="Show every ticket again">Clear</button>}
        <kbd className="rounded border border-[var(--theme-border-input)] px-1 font-mono text-[10px] text-[var(--theme-text-muted)]">Esc</kbd>
      </div>
    </div>
  );
}

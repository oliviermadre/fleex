import { useEffect, useMemo } from 'react';
import { TICKET_TYPE_LABELS, TICKET_TYPES, type TicketPriority, type TicketType } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { MultiSelect } from '../components/ui/MultiSelect';
import { TicketTypeIconSvg } from '../components/tickets/TicketTypeIconSvg';
import { PriorityIndicator, PRIORITY_LABELS, PRIORITY_ORDER_DESC } from '../components/tickets/PriorityIndicator';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { finderActive, NO_FINDER, type Finder } from './finder';
import { Star } from './FactoryTicketMeta';
import type { FactoryTicket } from './types';

/**
 * Search and filters for the floor, in the page header. Nothing it leaves out
 * disappears: those tickets fade, the ones kept stand out with their name.
 * Enter jumps to the next ticket found.
 */
export function FactoryFinder({ finder, onChange, tickets, found, onJump, inputRef }: {
  finder: Finder; onChange: (f: Finder) => void; tickets: FactoryTicket[]; found: FactoryTicket[] | null; onJump: () => void; inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const boards = useTicketStore((s) => s.boards), fetchBoards = useTicketStore((s) => s.fetchBoards);
  useEffect(() => { if (boards.length === 0) void fetchBoards().catch(() => {}); }, [boards.length, fetchBoards]);
  /* only the boards that have a ticket on the floor are worth offering, with how many */
  const boardOptions = useMemo(() => {
    const count = new Map<string, number>();
    for (const t of tickets) if (t.info) count.set(t.info.boardId, (count.get(t.info.boardId) ?? 0) + 1);
    return [...count].map(([id, n]) => ({ value: id, label: `${boards.find((b) => b.id === id)?.name ?? 'Unknown board'} · ${n}` })).sort((a, b) => a.label.localeCompare(b.label));
  }, [tickets, boards]);
  const typeOptions = useMemo(() => [
    ...TICKET_TYPES.map((t) => ({ value: t as string, label: TICKET_TYPE_LABELS[t] ?? t, icon: <TicketTypeIconSvg type={t as TicketType} size={13} /> })),
    { value: 'none', label: 'No type', icon: <TicketTypeIconSvg type={null} size={13} /> },
  ], []);
  const priorityOptions = useMemo(() => PRIORITY_ORDER_DESC.map((p) => ({ value: p as string, label: PRIORITY_LABELS[p as TicketPriority], icon: <PriorityIndicator priority={p} /> })), []);
  const set = (patch: Partial<Finder>) => onChange({ ...finder, ...patch });
  const active = finderActive(finder);
  const toggle = 'inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors';
  const on = 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]', off = 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]';

  return (
    <div className="flex min-w-0 items-center gap-1 overflow-hidden p-0.5" role="search" aria-label="Find tickets on the floor">
      <Input ref={inputRef} id="factory-find" type="search" value={finder.q} placeholder="Find a ticket ( / )" aria-label="Find a ticket by title, number or tag" autoComplete="off"
        onChange={(e) => set({ q: e.target.value })} className="w-56 py-1 text-xs"
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onJump(); } else if (e.key === 'Escape') { e.preventDefault(); if (finder.q) set({ q: '' }); else e.currentTarget.blur(); } }} />
      <MultiSelect label="Boards" values={finder.boards} options={boardOptions} onChange={(boards) => set({ boards })} searchable={boardOptions.length > 8} />
      <MultiSelect label="Types" values={finder.types} options={typeOptions} onChange={(types) => set({ types })} searchable={false} />
      <MultiSelect label="Priorities" allLabel="All priorities" values={finder.priorities} options={priorityOptions} onChange={(priorities) => set({ priorities })} searchable={false} />
      <button type="button" className={cn(toggle, finder.favorite ? on : off)} aria-pressed={finder.favorite} onClick={() => set({ favorite: !finder.favorite })} title="Only your favourites"><Star on={finder.favorite} size={11} />Favourites</button>
      <button type="button" className={cn(toggle, finder.waiting ? on : off)} aria-pressed={finder.waiting} onClick={() => set({ waiting: !finder.waiting })} title="Only tickets that wait for you">Waiting for me</button>
      {active && found && (
        <>
          <span className="flex-none whitespace-nowrap font-mono text-[11px] text-[var(--theme-text-secondary)]" aria-live="polite">{found.length} of {tickets.length}</span>
          <Button size="sm" variant="ghost" onClick={() => onChange(NO_FINDER)} title="Show every ticket again">Clear</Button>
        </>
      )}
    </div>
  );
}

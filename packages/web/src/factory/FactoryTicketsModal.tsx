import { useEffect, useMemo, useRef, useState } from 'react';
import { TICKET_COMPLEXITIES, TICKET_STATUSES, TICKET_TYPE_LABELS, TICKET_TYPES, type TicketPriority, type TicketType } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { MultiSelect } from '../components/ui/MultiSelect';
import { Select } from '../components/ui/Select';
import { TicketTypeIconSvg } from '../components/tickets/TicketTypeIconSvg';
import { PriorityIndicator, PRIORITY_LABELS, PRIORITY_ORDER_DESC } from '../components/tickets/PriorityIndicator';
import { ComplexityBadge } from '../components/tickets/ComplexityBadge';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';
import { find, finderActive, NO_FINDER, STATE_LABEL, stateOf, STATES, type Finder, type TicketState } from './finder';
import { complexityOf, priorityOf, Star, TicketToken, typeLabel, typeOf } from './FactoryTicketMeta';
import { since, span } from './format';
import { humanCall, needsHuman, type FactoryTicket, type MachineSpec } from './types';

type Sort = 'human' | 'here' | 'number' | 'priority' | 'where';
const SORTS: { value: Sort; label: string }[] = [
  { value: 'human', label: 'Waiting for you first' }, { value: 'here', label: 'Longest where it is' }, { value: 'priority', label: 'Most urgent' },
  { value: 'where', label: 'By machine' }, { value: 'number', label: 'By number' },
];
const RANK: Record<string, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };
const complexityName = (v: string) => (v === 'inf' ? '∞' : `${v} pts`);

const whereOf = (m: MachineSpec | null): string => (!m ? 'On the floor' : m.kind === 'belt' || m.kind === 'bridge' ? 'On a belt' : m.kind === 'arm' ? 'In an arm' : m.name || (m.kind === 'station' ? 'Station' : 'Zone'));

/**
 * Every ticket on the floor, as a list: what it is, where it is and what it
 * waits for, with the same filters as the floor's own. "Go to" closes the list
 * and centres the floor on the ticket; "Detail" opens its popup. Tab opens the
 * list and Tab closes it.
 *
 * The filters are the page's: what is set here fades the same tickets on the
 * floor, and the other way round.
 */
export function FactoryTicketsModal({ finder, onFinder, onGoTo, onDetail, onClose }: {
  finder: Finder; onFinder: (f: Finder) => void; onGoTo: (ticketId: string) => void; onDetail: (ticketId: string) => void; onClose: () => void;
}) {
  const snapshot = useFactoryStore((s) => s.snapshot), layout = useFactoryStore((s) => s.layout);
  const boards = useTicketStore((s) => s.boards);
  const [sort, setSort] = useState<Sort>('human');
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { search.current?.focus(); }, []);
  /* Tab opened the list, Tab closes it: inside the list the key is not for moving between fields */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const tickets = useMemo(() => snapshot?.tickets ?? [], [snapshot]), now = snapshot?.serverTime ?? '';
  const machines = useMemo(() => new Map((layout?.machines ?? []).map((m) => [m.id, m])), [layout]);
  const set = (patch: Partial<Finder>) => onFinder({ ...finder, ...patch });
  const waits = (t: FactoryTicket) => humanCall(t) !== null;

  const rows = useMemo(() => {
    const kept = find(tickets, finder, waits) ?? [...tickets];
    const here = (t: FactoryTicket) => since(t.since, now), where = (t: FactoryTicket) => whereOf(machines.get(t.machineId ?? '') ?? null);
    const by: Record<Sort, (a: FactoryTicket, b: FactoryTicket) => number> = {
      human: (a, b) => Number(waits(b)) - Number(waits(a)) || here(b) - here(a),
      here: (a, b) => here(b) - here(a),
      number: (a, b) => (a.info?.displayId ?? 0) - (b.info?.displayId ?? 0),
      priority: (a, b) => (RANK[priorityOf(a.info)] ?? 4) - (RANK[priorityOf(b.info)] ?? 4) || here(b) - here(a),
      where: (a, b) => where(a).localeCompare(where(b)) || here(b) - here(a),
    };
    return kept.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, finder, sort, machines, now]);

  // ---- what each criterion can be set to, from what is on the floor ----
  const count = <K extends string>(key: (t: FactoryTicket) => K | null) => { const n = new Map<K, number>(); for (const t of tickets) { const k = key(t); if (k !== null) n.set(k, (n.get(k) ?? 0) + 1); } return n; };
  const boardOptions = useMemo(() => [...count((t) => t.info?.boardId ?? null)].map(([id, n]) => ({ value: id, label: `${boards.find((b) => b.id === id)?.name ?? 'Unknown board'} · ${n}` })).sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, boards]);
  const machineOptions = useMemo(() => [...count((t) => { const m = machines.get(t.machineId ?? ''); return m && (m.kind === 'station' || m.kind === 'zone') ? m.id : null; })]
    .map(([id, n]) => ({ value: id, label: `${whereOf(machines.get(id) ?? null)} · ${n}` })).sort((a, b) => a.label.localeCompare(b.label)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tickets, machines]);
  const typeOptions = useMemo(() => [...TICKET_TYPES.map((t) => ({ value: t as string, label: TICKET_TYPE_LABELS[t] ?? t, icon: <TicketTypeIconSvg type={t as TicketType} size={13} /> })), { value: 'none', label: 'No type', icon: <TicketTypeIconSvg type={null} size={13} /> }], []);
  const priorityOptions = useMemo(() => PRIORITY_ORDER_DESC.map((p) => ({ value: p as string, label: PRIORITY_LABELS[p as TicketPriority], icon: <PriorityIndicator priority={p} /> })), []);
  const statusOptions = useMemo(() => TICKET_STATUSES.map((s) => ({ value: s as string, label: s })), []);
  const stateOptions = useMemo(() => STATES.map((s) => ({ value: s, label: STATE_LABEL[s] })), []);
  const bounds = [{ value: '', label: 'any' }, ...TICKET_COMPLEXITIES.map((c) => ({ value: c as string, label: complexityName(c) }))];

  const pill = 'inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors';
  const on = 'bg-[var(--theme-accent-muted)] text-[var(--theme-accent)]', off = 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]';
  const Toggle = ({ value, flip, children, title }: { value: boolean; flip: () => void; children: React.ReactNode; title: string }) => (
    <button type="button" className={cn(pill, value ? on : off)} aria-pressed={value} onClick={flip} title={title}>{children}</button>
  );
  /*
   * A drop-down of filters closes on Escape, and the list must not close with it: while its button has the focus, the
   * key is the drop-down's. Once it is closed, the same key closes the list.
   */
  const guard = (node: React.ReactNode) => (
    <span data-modal-escape-local onKeyDown={(e) => { if (e.key === 'Escape' && (e.target as HTMLElement).getAttribute('aria-expanded') !== 'true') onClose(); }}>{node}</span>
  );
  const cols = 'grid grid-cols-[30px_minmax(0,2.4fr)_92px_92px_44px_minmax(0,1.2fr)_minmax(0,1.3fr)_64px_minmax(0,0.9fr)_132px] items-center gap-x-3';

  return (
    <Modal open onClose={onClose} maxWidth="max-w-[1400px]" variant="glass">
      <div className="flex h-[86vh] flex-col gap-3">
        <div className="flex flex-none items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[var(--theme-text-primary)]">Tickets on the floor</div>
            <p className="text-xs text-[var(--theme-text-muted)]">{finderActive(finder) ? `${rows.length} of ${tickets.length} shown: the others are faded on the floor too.` : `${tickets.length} ticket${tickets.length === 1 ? '' : 's'}.`} Tab closes this list.</p>
          </div>
          <div className="w-52"><Select id="factory-tickets-sort" aria-label="Order" value={sort} onChange={(e) => setSort(e.target.value as Sort)} options={SORTS} /></div>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-x-1 gap-y-1.5" role="search" aria-label="Filter the tickets">
          <Input ref={search} id="factory-tickets-find" type="search" value={finder.q} placeholder="Title, number or tag" aria-label="Find a ticket by title, number or tag" autoComplete="off"
            onChange={(e) => set({ q: e.target.value })} className="w-56 py-1 text-xs" />
          {guard(<MultiSelect label="Boards" values={finder.boards} options={boardOptions} onChange={(v) => set({ boards: v })} searchable={boardOptions.length > 8} />)}
          {guard(<MultiSelect label="Types" values={finder.types} options={typeOptions} onChange={(v) => set({ types: v })} searchable={false} />)}
          {guard(<MultiSelect label="Priorities" allLabel="All priorities" values={finder.priorities} options={priorityOptions} onChange={(v) => set({ priorities: v })} searchable={false} />)}
          {guard(<MultiSelect label="Statuses" allLabel="All statuses" values={finder.statuses} options={statusOptions} onChange={(v) => set({ statuses: v })} searchable={false} />)}
          {guard(<MultiSelect label="Machines" values={finder.machines} options={machineOptions} onChange={(v) => set({ machines: v })} searchable={machineOptions.length > 8} />)}
          {guard(<MultiSelect label="States" values={finder.states} options={stateOptions} onChange={(v) => set({ states: v as TicketState[] })} searchable={false} />)}
          <span className="ml-1 inline-flex items-center gap-1 text-[11px] text-[var(--theme-text-muted)]">
            Complexity from
            <Select id="factory-tickets-cmin" aria-label="Complexity from" value={finder.complexityMin} onChange={(e) => set({ complexityMin: e.target.value })} options={bounds} className="px-1.5 py-0.5 text-[11px]" />
            to
            <Select id="factory-tickets-cmax" aria-label="Complexity to" value={finder.complexityMax} onChange={(e) => set({ complexityMax: e.target.value })} options={bounds} className="px-1.5 py-0.5 text-[11px]" />
          </span>
          <Toggle value={finder.unestimated} flip={() => set({ unestimated: !finder.unestimated })} title="Tickets with no estimate">Not estimated</Toggle>
          <Toggle value={finder.favorite} flip={() => set({ favorite: !finder.favorite })} title="Only your favourites"><Star on={finder.favorite} size={11} />Favourites</Toggle>
          <Toggle value={finder.waiting} flip={() => set({ waiting: !finder.waiting })} title="Only tickets that wait for you">Waiting for me</Toggle>
          <Toggle value={finder.blocked} flip={() => set({ blocked: !finder.blocked })} title="Only tickets marked as blocked">Blocked</Toggle>
          {finderActive(finder) && <Button size="sm" variant="ghost" onClick={() => onFinder(NO_FINDER)} title="Show every ticket again">Clear</Button>}
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--theme-border)]">
          <div className={cn(cols, 'flex-none border-b border-[var(--theme-border)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]')} role="row">
            <span /><span>Ticket</span><span>Type</span><span>Priority</span><span title="Complexity">Cx</span><span>Where</span><span>State</span><span>For</span><span>Board</span><span />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto" role="table" aria-label="Tickets on the floor">
            {rows.length === 0 && <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">{tickets.length ? 'No ticket matches these filters.' : 'No ticket on the floor yet.'}</div>}
            {rows.map((t) => {
              const info = t.info, why = needsHuman(t), m = machines.get(t.machineId ?? '') ?? null, state = stateOf(t);
              return (
                <div key={t.ticketId} role="row" className={cn(cols, 'border-b border-[var(--theme-border)] px-3 py-1.5 text-xs last:border-b-0 hover:bg-[var(--theme-bg-overlay)]')}>
                  <TicketToken info={info} size={22} />
                  <button type="button" className="min-w-0 text-left" onClick={() => onDetail(t.ticketId)} title={info?.title ?? ''}>
                    <span className="block truncate font-medium text-[var(--theme-text-primary)] hover:underline"><span className="mr-1.5 font-mono font-normal text-[var(--theme-text-muted)]">#{info?.displayId ?? '?'}</span>{info?.title ?? t.ticketId}</span>
                    {info && info.tags.length > 0 && <span className="block truncate text-[11px] text-[var(--theme-text-muted)]">{info.tags.join(' · ')}</span>}
                  </button>
                  <span className="flex min-w-0 items-center gap-1.5 text-[var(--theme-text-secondary)]"><TicketTypeIconSvg type={typeOf(info)} size={14} /><span className="whitespace-nowrap">{typeLabel(info)}</span></span>
                  <span className="flex min-w-0 items-center gap-1.5 text-[var(--theme-text-secondary)]"><PriorityIndicator priority={priorityOf(info)} /><span className="whitespace-nowrap">{PRIORITY_LABELS[priorityOf(info)]}</span></span>
                  <span><ComplexityBadge complexity={complexityOf(info)} /></span>
                  <span className="truncate text-[var(--theme-text-primary)]">{whereOf(m)}</span>
                  <span className={cn('min-w-0 leading-snug', why ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-secondary)]')} title={t.note || undefined}>
                    {t.phase === 'review' ? 'Waiting for your decision' : t.phase === 'question' ? 'The agent asked a question' : t.phase === 'failed' ? 'The run failed' : t.phase === 'aside' ? 'Set aside by you' : t.phase === 'zone' && t.released ? 'Released' : STATE_LABEL[state]}{t.outcome && state !== 'human' ? ` · ${t.outcome}` : ''}
                  </span>
                  <span className="font-mono text-[var(--theme-text-secondary)]">{now ? span(since(t.since, now)) : ''}</span>
                  <span className="truncate text-[var(--theme-text-muted)]">{info ? boards.find((b) => b.id === info.boardId)?.name ?? '' : ''}{info?.blocked ? ' · blocked' : ''}</span>
                  <span className="flex justify-end gap-1">
                    <Button size="sm" onClick={() => onGoTo(t.ticketId)} title="Close the list, centre the floor on this ticket and select it">Go to</Button>
                    <Button size="sm" variant="ghost" onClick={() => onDetail(t.ticketId)} title="Close the list and open the ticket: its thread, its deliverables, what it waits for">Detail</Button>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}

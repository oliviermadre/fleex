import { useEffect, useMemo, useState } from 'react';
import { PRIORITY_ORDER_DESC, PriorityIndicator, PRIORITY_LABELS } from '../components/tickets/PriorityIndicator';
import { TICKET_TYPE_LABELS, TICKET_TYPES, type TicketPriority, type TicketType } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { MultiSelect } from '../components/ui/MultiSelect';
import { TicketTypeIconSvg } from '../components/tickets/TicketTypeIconSvg';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import { PeriodSelect, periodLabel } from './FactoryStatsBits';
import { priorityOf, TicketToken, typeLabel, typeOf } from './FactoryTicketMeta';
import { span } from './format';
import { ITEM_SOURCES, refOf, SOURCE_LABEL, sourceType } from './items';
import type { ExitLog, FactoryTicketInfo } from './types';
import { KindChoice, showsKind, useKinds } from './KindChoice';

/** What a line is now: a ticket still done, set back to work since it left, archived, deleted since; an item (archived). */
export type ExitNow = 'done' | 'reopened' | 'archived' | 'deleted';
const NOW_LABEL: Record<ExitNow, string> = { done: 'Done', reopened: 'Reopened since', archived: 'Archived', deleted: 'Deleted since' };

/** One line of the list: a ticket an exit shipped, or an item archived there. */
export interface ExitRow {
  key: string; machineId: string; ticketId: string | null; url: string | null; info: FactoryTicketInfo; source: string | null;
  lead: number; shippedAt: string;
  /** What it is now, in words (`reopened · doing`), and as a filter knows it. */
  now: string; state: ExitNow; reopened: boolean;
}

/** The tickets and the items of a log in one list, the latest out first. */
export function exitRows(log: ExitLog): ExitRow[] {
  const lead = (a: string, b: string) => Math.max(0, Date.parse(b) - Date.parse(a));
  const tickets: ExitRow[] = log.tickets.map((t) => {
    const reopened = !!t.status && t.status !== 'done' && !t.archived;
    const state: ExitNow = t.displayId === null ? 'deleted' : t.archived ? 'archived' : reopened ? 'reopened' : 'done';
    return {
      key: `t:${t.ticketId}:${t.shippedAt}`, machineId: t.machineId, ticketId: t.displayId === null ? null : t.ticketId, url: null, source: null, lead: lead(t.handedAt, t.shippedAt), shippedAt: t.shippedAt,
      info: { id: t.ticketId, displayId: t.displayId ?? 0, title: t.title, type: t.type, priority: t.priority, status: (t.status ?? 'done') as FactoryTicketInfo['status'], tags: t.tags, boardId: t.boardId ?? '', complexity: null, favorite: false, blocked: false },
      now: state === 'deleted' ? 'deleted since' : state === 'archived' ? 'archived' : reopened ? `reopened · ${t.status}` : t.status ?? 'done', state, reopened,
    };
  });
  const items: ExitRow[] = log.items.map((i) => ({
    key: `i:${i.itemId}:${i.shippedAt}`, machineId: i.machineId, ticketId: null, url: i.url, source: SOURCE_LABEL[i.source] ?? i.source, lead: lead(i.handedAt, i.shippedAt), shippedAt: i.shippedAt,
    info: { id: i.itemId, displayId: 0, title: i.title, type: sourceType(i.source), priority: '', status: 'done', tags: i.tags, boardId: '', complexity: null, favorite: false, blocked: false },
    now: 'archived', state: 'archived', reopened: false,
  }));
  return [...tickets, ...items].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));
}

/** What the list is narrowed to: none of a criterion means all of it. */
export interface ExitFilter { q: string; exits: string[]; boards: string[]; types: string[]; priorities: string[]; states: ExitNow[] }
export const NO_EXIT_FILTER: ExitFilter = { q: '', exits: [], boards: [], types: [], priorities: [], states: [] };
const active = (f: ExitFilter) => !!f.q.trim() || f.exits.length + f.boards.length + f.types.length + f.priorities.length + f.states.length > 0;

/** The lines a filter keeps. An item has no board nor priority: a filter on either leaves it out; its type is its source (`src:gmail`). */
export function filterExitRows(rows: readonly ExitRow[], f: ExitFilter): ExitRow[] {
  const needle = f.q.trim().toLowerCase().replace(/^#/, '');
  return rows.filter((r) => {
    if (needle && !r.info.title.toLowerCase().includes(needle) && !(r.ticketId && String(r.info.displayId).startsWith(needle)) && !r.info.tags.some((t) => t.toLowerCase().includes(needle))) return false;
    if (f.exits.length && !f.exits.includes(r.machineId)) return false;
    if (f.boards.length && (r.source || !f.boards.includes(r.info.boardId))) return false;
    if (f.types.length && !f.types.includes(r.source ? r.info.type : typeOf(r.info) ?? 'none')) return false;
    if (f.priorities.length && (r.source || !f.priorities.includes(priorityOf(r.info)))) return false;
    if (f.states.length && !f.states.includes(r.state)) return false;
    return true;
  });
}

/** How many left each day of the period, oldest first, the last one today (local days). */
export function perDay(rows: readonly ExitRow[], days: number, now: Date = new Date()): { day: Date; n: number }[] {
  const start = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = start(now), out = Array.from({ length: days }, (_, i) => ({ day: new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i)), n: 0 }));
  for (const r of rows) {
    const k = Math.round((today.getTime() - start(new Date(r.shippedAt)).getTime()) / 86_400_000);
    if (k >= 0 && k < days) out[days - 1 - k]!.n++;
  }
  return out;
}

/** When it left: today 11:42, yesterday 17:20, Mon 16:05, then 12 Nov. */
export function shippedWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso), hm = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(), diff = Math.round((day(now) - day(d)) / 86_400_000);
  if (diff <= 0) return `today ${hm}`;
  if (diff === 1) return `yesterday ${hm}`;
  if (diff < 7) return `${d.toLocaleDateString('en-GB', { weekday: 'short' })} ${hm}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2); return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Tickets shipped each day of the period, as bars: one series, in the accent, the day and its count on hover. */
function Throughput({ days }: { days: { day: Date; n: number }[] }) {
  const max = Math.max(1, ...days.map((d) => d.n)), W = 220, H = 40, gap = 2, bw = Math.max(1, (W - gap * (days.length - 1)) / days.length);
  return (
    <svg width={W} height={H + 12} viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label="Tickets shipped per day" className="flex-none">
      <line x1={0} x2={W} y1={H + 0.5} y2={H + 0.5} stroke="var(--theme-border)" strokeWidth={1} />
      {days.map((d, i) => {
        const h = d.n ? Math.max(3, (d.n / max) * (H - 2)) : 0, x = i * (bw + gap), label = `${d.day.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}: ${d.n} shipped`;
        return (
          <g key={i}>
            <rect x={x} y={0} width={bw} height={H} fill="transparent"><title>{label}</title></rect>
            {h > 0 && <rect x={x} y={H - h} width={bw} height={h} rx={Math.min(2, bw / 2)} fill="var(--theme-accent)" pointerEvents="none" />}
          </g>
        );
      })}
      <text x={0} y={H + 11} fontSize={9} fill="var(--theme-text-muted)">{days[0]?.day.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</text>
      <text x={W} y={H + 11} fontSize={9} fill="var(--theme-text-muted)" textAnchor="end">today</text>
    </svg>
  );
}

/**
 * What left the floor by an exit (`machineId`), or by every exit of the floor (null, grouped by exit), over the stats'
 * period (the one the exits' counters on the floor show): the tickets shipped, each with its lead time (hand-over to
 * exit), when it left and what it is now (one set back to work since is flagged), and the items archived there, the
 * latest first. Filters as the ticket list's (Tab), figures over what they keep, and the throughput per day. Picked on
 * `docs/factory/exit-log.html` (A, A, A). A double-click on an exit (View) opens one; Exits on the floor's card, all.
 */
export function FactoryExitLog({ machineId, onSettings, onOpenTicket, onClose }: { machineId: string | null; onSettings?: () => void; onOpenTicket: (ticketId: string) => void; onClose: () => void }) {
  const days = useFactoryStore((s) => s.statsDays);
  const boards = useTicketStore((s) => s.boards);
  const [log, setLog] = useState<ExitLog | null>(null), [failed, setFailed] = useState(false), [f, setF] = useState<ExitFilter>(NO_EXIT_FILTER);
  useEffect(() => {
    let live = true;
    const load = () => factoryApi.exitLog(machineId, days).then((l) => { if (live) { setLog(l); setFailed(false); } }, () => { if (live) setFailed(true); });
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [machineId, days]);

  const rows = useMemo(() => (log ? exitRows(log) : []), [log]);
  /* tickets, items or both (it opens on both: an exit's items are part of what left) */
  const [kinds, setKinds] = useKinds('exits', 'both');
  const shown = useMemo(() => filterExitRows(rows, f).filter((r) => showsKind(kinds, !!r.source)), [rows, f, kinds]);
  const exits = log?.exits ?? [], exitName = (id: string) => exits.find((e) => e.machineId === id)?.name ?? 'Exit';
  const name = machineId ? exitName(machineId) : 'Exits';
  const set = (patch: Partial<ExitFilter>) => setF((cur) => ({ ...cur, ...patch }));

  const shipped = shown.filter((r) => !r.source), items = shown.length - shipped.length, lead = median(shipped.map((r) => r.lead)), reopened = shipped.filter((r) => r.reopened).length;
  const daily = useMemo(() => perDay(shipped, Math.min(days, 90)), [shipped, days]);
  const rate = shipped.length / Math.max(1, days);

  /* what each criterion can be set to, from what left */
  const count = (key: (r: ExitRow) => string | null) => { const n = new Map<string, number>(); for (const r of rows) { const k = key(r); if (k) n.set(k, (n.get(k) ?? 0) + 1); } return n; };
  const exitOptions = exits.map((e) => ({ value: e.machineId, label: `${e.name}${e.onFloor ? '' : ' (removed)'} · ${count((r) => r.machineId).get(e.machineId) ?? 0}` }));
  const boardOptions = [...count((r) => (r.source ? null : r.info.boardId || null))].map(([id, n]) => ({ value: id, label: `${boards.find((b) => b.id === id)?.name ?? 'Unknown board'} · ${n}` })).sort((a, b) => a.label.localeCompare(b.label));
  const typeOptions = [
    ...TICKET_TYPES.map((t) => ({ value: t as string, label: TICKET_TYPE_LABELS[t] ?? t, icon: <TicketTypeIconSvg type={t as TicketType} size={13} /> })),
    { value: 'none', label: 'No type', icon: <TicketTypeIconSvg type={null} size={13} /> },
    ...ITEM_SOURCES.filter((s) => rows.some((r) => r.info.type === sourceType(s))).map((s) => ({ value: sourceType(s), label: `${SOURCE_LABEL[s]} item` })),
  ];
  const priorityOptions = PRIORITY_ORDER_DESC.map((p) => ({ value: p as string, label: PRIORITY_LABELS[p as TicketPriority], icon: <PriorityIndicator priority={p} /> }));
  const stateOptions = (Object.keys(NOW_LABEL) as ExitNow[]).map((s) => ({ value: s, label: NOW_LABEL[s] }));
  /* a drop-down closes on Escape, and the list must not close with it (as in the ticket list) */
  const guard = (node: React.ReactNode) => (
    <span data-modal-escape-local onKeyDown={(e) => { if (e.key === 'Escape' && (e.target as HTMLElement).getAttribute('aria-expanded') !== 'true') onClose(); }}>{node}</span>
  );

  /* every exit: grouped by exit, in the order of the floor; one exit: one group */
  const groups = machineId ? [{ id: machineId, rows: shown }] : exits.map((e) => ({ id: e.machineId, rows: shown.filter((r) => r.machineId === e.machineId) })).filter((g) => g.rows.length > 0);
  const cols = 'grid grid-cols-[30px_minmax(0,2.4fr)_92px_92px_minmax(0,1fr)_84px_112px_minmax(0,1fr)_132px] items-center gap-x-3';
  const tile = (value: string | number, label: string, tone?: string) => (
    <div className="flex flex-col rounded-md border border-[var(--theme-border)] px-3 py-1.5">
      <b className={cn('font-mono text-base tabular-nums', tone ?? 'text-[var(--theme-text-primary)]')}>{value}</b>
      <span className="text-[11px] text-[var(--theme-text-muted)]">{label}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} maxWidth="max-w-[1400px]" variant="glass">
      <div className="flex h-[86vh] flex-col gap-3" role="region" aria-label={machineId ? `What left by ${name}` : 'What left by the exits'}>
        <div className="flex flex-none items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[var(--theme-text-primary)]">{name} <span className="font-normal text-[var(--theme-text-muted)]">· {machineId ? 'what left by it' : `what left by the ${exits.length} exit${exits.length === 1 ? '' : 's'}`}</span></div>
            <p className="text-xs text-[var(--theme-text-muted)]">{periodLabel(days)}, the period of the stats: the exits' counters on the floor follow it. {active(f) ? `${shown.length} of ${rows.length} shown.` : ''} Esc closes.</p>
          </div>
          {onSettings && <Button size="sm" onClick={onSettings} title="The exit's name and size">Settings</Button>}
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="flex flex-none flex-wrap items-end gap-2">
          {tile(shipped.length, 'tickets shipped')}
          {tile(`${rate < 10 ? rate.toFixed(1) : Math.round(rate)} / day`, 'throughput')}
          {tile(lead === null ? '–' : span(lead), 'median lead time')}
          {tile(reopened, 'reopened since', reopened ? 'text-[var(--theme-warning)]' : undefined)}
          {items > 0 && tile(items, 'items archived')}
          <div className="ml-auto flex flex-col items-end gap-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Shipped per day</span>
            <Throughput days={daily} />
          </div>
        </div>

        <div className="flex flex-none flex-wrap items-center gap-x-1 gap-y-1.5" role="search" aria-label="Filter what left">
          <Input id="factory-exit-find" type="search" value={f.q} placeholder="Title, number or tag" aria-label="Find by title, number or tag" autoComplete="off" onChange={(e) => set({ q: e.target.value })} className="w-56 py-1 text-xs" />
          <div className="w-40"><PeriodSelect id="factory-exit-period" /></div>
          {!machineId && exits.length > 1 && guard(<MultiSelect label="Exits" values={f.exits} options={exitOptions} onChange={(v) => set({ exits: v })} searchable={exitOptions.length > 8} />)}
          {guard(<MultiSelect label="Boards" values={f.boards} options={boardOptions} onChange={(v) => set({ boards: v })} searchable={boardOptions.length > 8} />)}
          {guard(<MultiSelect label="Types" values={f.types} options={typeOptions} onChange={(v) => set({ types: v })} searchable={false} />)}
          {guard(<MultiSelect label="Priorities" allLabel="All priorities" values={f.priorities} options={priorityOptions} onChange={(v) => set({ priorities: v })} searchable={false} />)}
          {guard(<MultiSelect label="Now" allLabel="Any state now" values={f.states} options={stateOptions} onChange={(v) => set({ states: v as ExitNow[] })} searchable={false} />)}
          {active(f) && <Button size="sm" variant="ghost" onClick={() => setF(NO_EXIT_FILTER)} title="Show everything again">Clear</Button>}
          <span className="ml-auto"><KindChoice value={kinds} onChange={setKinds} tickets={rows.filter((r) => !r.source).length} items={rows.filter((r) => r.source).length} /></span>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--theme-border)]">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[900px]">
              <div className={cn(cols, 'sticky top-0 z-[1] border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]')} role="row">
                <span /><span>Ticket</span><span>Type</span><span>Priority</span><span>Board</span><span title="From hand-over to the exit">Lead time</span><span>Left</span><span>Now</span><span />
              </div>
              <div role="table" aria-label={machineId ? `What left by ${name}` : 'What left by the exits'}>
                {!log && <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">{failed ? 'Could not read what left by the exits.' : 'Reading what left…'}</div>}
                {log && shown.length === 0 && <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">{rows.length ? 'Nothing matches these filters.' : 'Nothing left over the period.'}</div>}
                {groups.map((g) => (
                  <div key={g.id} role="rowgroup" aria-label={exitName(g.id)}>
                    {!machineId && (
                      <div className="flex items-baseline gap-2 border-b border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-3 py-1 text-[11px] font-semibold text-[var(--theme-text-secondary)]">
                        {exitName(g.id)}<span className="font-normal text-[var(--theme-text-muted)]">{g.rows.filter((r) => !r.source).length} shipped{exits.find((e) => e.machineId === g.id)?.onFloor === false ? ' · no longer on the floor' : ''}</span>
                      </div>
                    )}
                    {g.rows.map((r) => (
                      <div key={r.key} role="row" className={cn(cols, 'border-b border-[var(--theme-border)] px-3 py-1.5 text-xs last:border-b-0 hover:bg-[var(--theme-bg-overlay)]')}>
                        <TicketToken info={r.info} size={22} />
                        <button type="button" className="min-w-0 text-left" disabled={!r.ticketId} onClick={() => r.ticketId && onOpenTicket(r.ticketId)} title={r.info.title}>
                          <span className={cn('block truncate font-medium text-[var(--theme-text-primary)]', r.ticketId && 'hover:underline')}><span className="mr-1.5 font-mono font-normal text-[var(--theme-text-muted)]">{r.source ?? (r.ticketId ? refOf(r.info) : '')}</span>{r.info.title}</span>
                          {r.info.tags.length > 0 && <span className="block truncate text-[11px] text-[var(--theme-text-muted)]">{r.info.tags.join(' · ')}</span>}
                        </button>
                        <span className="flex min-w-0 items-center gap-1.5 text-[var(--theme-text-secondary)]">{!r.source && <TicketTypeIconSvg type={typeOf(r.info)} size={14} />}<span className="whitespace-nowrap">{typeLabel(r.info)}</span></span>
                        <span className="flex min-w-0 items-center gap-1.5 text-[var(--theme-text-secondary)]">{r.source ? '–' : <><PriorityIndicator priority={priorityOf(r.info)} /><span className="whitespace-nowrap">{PRIORITY_LABELS[priorityOf(r.info)]}</span></>}</span>
                        <span className="truncate text-[var(--theme-text-muted)]">{r.source ? '–' : boards.find((b) => b.id === r.info.boardId)?.name ?? ''}</span>
                        <span className="font-mono tabular-nums text-[var(--theme-text-secondary)]">{span(r.lead)}</span>
                        <span className="font-mono tabular-nums text-[var(--theme-text-secondary)]" title={new Date(r.shippedAt).toLocaleString()}>{shippedWhen(r.shippedAt)}</span>
                        <span className={cn('truncate', r.reopened ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')} title={r.reopened ? 'Set back to work since it left' : undefined}>{r.now}</span>
                        <span className="flex justify-end gap-1">
                          {r.ticketId && <Button size="sm" variant="ghost" onClick={() => onOpenTicket(r.ticketId!)} title="Open the ticket: its thread, its deliverables">Detail</Button>}
                          {r.url && <Button size="sm" variant="ghost" onClick={() => window.open(r.url!, '_blank', 'noopener')}>Open in {r.source}</Button>}
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { TicketTypeIconSvg } from '../components/tickets/TicketTypeIconSvg';
import { PriorityIndicator, PRIORITY_LABELS } from '../components/tickets/PriorityIndicator';
import { useTicketStore } from '../stores/ticketStore';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import { PeriodSelect, periodLabel } from './FactoryStatsBits';
import { priorityOf, TicketToken, typeLabel, typeOf } from './FactoryTicketMeta';
import { span } from './format';
import { refOf, SOURCE_LABEL, sourceType } from './items';
import type { ExitLog, FactoryTicketInfo } from './types';

/** One line of the list: a ticket the exit shipped, or an item archived there. */
export interface ExitRow {
  key: string; ticketId: string | null; url: string | null; info: FactoryTicketInfo; source: string | null;
  lead: number; shippedAt: string;
  /** What it is now: done, reopened (a ticket set back to work since), archived, gone. */
  now: string; reopened: boolean;
}

/** The tickets and the items of a log in one list, the latest out first. */
export function exitRows(log: ExitLog): ExitRow[] {
  const lead = (a: string, b: string) => Math.max(0, Date.parse(b) - Date.parse(a));
  const tickets: ExitRow[] = log.tickets.map((t) => {
    const reopened = !!t.status && t.status !== 'done' && !t.archived;
    return {
      key: `t:${t.ticketId}:${t.shippedAt}`, ticketId: t.displayId === null ? null : t.ticketId, url: null, source: null, lead: lead(t.handedAt, t.shippedAt), shippedAt: t.shippedAt,
      info: { id: t.ticketId, displayId: t.displayId ?? 0, title: t.title, type: t.type, priority: t.priority, status: (t.status ?? 'done') as FactoryTicketInfo['status'], tags: t.tags, boardId: t.boardId ?? '', complexity: null, favorite: false, blocked: false },
      now: t.displayId === null ? 'deleted since' : t.archived ? 'archived' : reopened ? `reopened · ${t.status}` : t.status ?? 'done', reopened,
    };
  });
  const items: ExitRow[] = log.items.map((i) => ({
    key: `i:${i.itemId}:${i.shippedAt}`, ticketId: null, url: i.url, source: SOURCE_LABEL[i.source] ?? i.source, lead: lead(i.handedAt, i.shippedAt), shippedAt: i.shippedAt,
    info: { id: i.itemId, displayId: 0, title: i.title, type: sourceType(i.source), priority: '', status: 'done', tags: i.tags, boardId: '', complexity: null, favorite: false, blocked: false },
    now: 'archived', reopened: false,
  }));
  return [...tickets, ...items].sort((a, b) => b.shippedAt.localeCompare(a.shippedAt));
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

/**
 * What left the floor by an exit over the stats' period (the one its counter on the floor shows): the tickets it
 * shipped, with how long each took from hand-over to the exit and what it is now (one set back to work since is
 * flagged), and the items archived there, in one list, the latest first. Picked on `docs/factory/exit-log.html`
 * (A, A, A). A double-click on an exit opens it out of build mode; its settings are a button away.
 */
export function FactoryExitLog({ machineId, onSettings, onOpenTicket, onClose }: { machineId: string; onSettings: () => void; onOpenTicket: (ticketId: string) => void; onClose: () => void }) {
  const days = useFactoryStore((s) => s.statsDays), name = useFactoryStore((s) => { const m = s.layout?.machines.find((q) => q.id === machineId); return m && 'name' in m ? m.name || 'Exit' : 'Exit'; });
  const boards = useTicketStore((s) => s.boards);
  const [log, setLog] = useState<ExitLog | null>(null), [failed, setFailed] = useState(false), [q, setQ] = useState('');
  useEffect(() => {
    let live = true;
    const load = () => factoryApi.exitLog(machineId, days).then((l) => { if (live) { setLog(l); setFailed(false); } }, () => { if (live) setFailed(true); });
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { live = false; clearInterval(timer); };
  }, [machineId, days]);

  const rows = useMemo(() => (log ? exitRows(log) : []), [log]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? rows.filter((r) => r.info.title.toLowerCase().includes(needle) || (r.ticketId && String(r.info.displayId).includes(needle.replace(/^#/, '')))) : rows;
  const shipped = rows.filter((r) => !r.source), items = rows.length - shipped.length, lead = median(shipped.map((r) => r.lead)), reopened = shipped.filter((r) => r.reopened).length;
  const cols = 'grid grid-cols-[30px_minmax(0,2.4fr)_92px_92px_minmax(0,1fr)_84px_112px_minmax(0,1fr)_132px] items-center gap-x-3';
  const tile = (value: string | number, label: string, tone?: string) => (
    <div className="flex flex-col rounded-md border border-[var(--theme-border)] px-3 py-1.5">
      <b className={cn('font-mono text-base tabular-nums', tone ?? 'text-[var(--theme-text-primary)]')}>{value}</b>
      <span className="text-[11px] text-[var(--theme-text-muted)]">{label}</span>
    </div>
  );

  return (
    <Modal open onClose={onClose} maxWidth="max-w-[1400px]" variant="glass">
      <div className="flex h-[86vh] flex-col gap-3" role="region" aria-label={`What left by ${name}`}>
        <div className="flex flex-none items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[var(--theme-text-primary)]">{name} <span className="font-normal text-[var(--theme-text-muted)]">· what left by it</span></div>
            <p className="text-xs text-[var(--theme-text-muted)]">{periodLabel(days)}, the period of the stats: the exit's counter on the floor follows it. Esc closes.</p>
          </div>
          <Button size="sm" onClick={onSettings} title="The exit's name and size">Settings</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        <div className="flex flex-none flex-wrap gap-2">
          {tile(shipped.length, 'tickets shipped')}
          {tile(lead === null ? '–' : span(lead), 'median lead time')}
          {tile(reopened, 'reopened since', reopened ? 'text-[var(--theme-warning)]' : undefined)}
          {items > 0 && tile(items, 'items archived')}
        </div>

        <div className="flex flex-none flex-wrap items-center gap-2">
          <Input id="factory-exit-find" type="search" value={q} placeholder="Title or number" aria-label="Find by title or number" autoComplete="off" onChange={(e) => setQ(e.target.value)} className="w-56 py-1 text-xs" />
          <div className="w-44"><PeriodSelect id="factory-exit-period" /></div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--theme-border)]">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[900px]">
              <div className={cn(cols, 'sticky top-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]')} role="row">
                <span /><span>Ticket</span><span>Type</span><span>Priority</span><span>Board</span><span title="From hand-over to the exit">Lead time</span><span>Left</span><span>Now</span><span />
              </div>
              <div role="table" aria-label={`What left by ${name}`}>
                {!log && <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">{failed ? 'Could not read what left by this exit.' : 'Reading what left by this exit…'}</div>}
                {log && shown.length === 0 && <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">{rows.length ? 'Nothing matches.' : 'Nothing left by this exit over the period.'}</div>}
                {shown.map((r) => (
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
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

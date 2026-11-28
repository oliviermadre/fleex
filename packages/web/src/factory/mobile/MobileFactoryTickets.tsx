import { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';
import { useMobileNavStore } from '../../mobile/mobileNavStore';
import { useFactoryStore } from '../factoryStore';
import { span } from '../format';
import { TicketToken } from '../FactoryTicketMeta';
import { NEED_LABEL, needsOf, type Need, type NeedKind } from '../needs';
import type { MachineSpec } from '../types';
import { BTN, TicketActsBar, useLastWord } from './MobileFactoryActs';
import { gestures } from './gestures';
import { useMobileFactoryStore } from './mobileFactoryStore';
import { groupTickets, matches, shortState, type TicketGroup } from './ticketList';

const CHIP: Record<NeedKind, string> = { decision: tint('yellow'), question: tint('yellow'), zone: tint('yellow'), failed: tint('red'), aside: tint('blue'), floor: tint('gray') };

/** What a ticket waits for, as the small plate on its card. */
export function NeedChip({ kind }: { kind: NeedKind }) {
  return <span className={cn('shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider', CHIP[kind])}>{NEED_LABEL[kind]}</span>;
}

/**
 * The tickets of the floor, on the phone's first screen. **Needs you**: what waits for someone, longest wait first
 * (the list of the page, `needs.ts`), each with its buttons. **All tickets**: every ticket, by the machine it stands
 * in, to follow the floor without the map. A search narrows both.
 */
export function MobileFactoryTickets() {
  const snapshot = useFactoryStore((s) => s.snapshot);
  const list = useMobileFactoryStore((s) => s.list), setList = useMobileFactoryStore((s) => s.setList);
  const pending = useMobileFactoryStore((s) => s.pending);
  const [query, setQuery] = useState('');
  const machines = snapshot?.floor.layout.machines, byId = useMemo(() => new Map((machines ?? []).map((m) => [m.id, m])), [machines]);
  /* a ticket whose gesture waits out its undo window is already out of what waits for you */
  const needs = useMemo(() => (snapshot ? needsOf(snapshot.tickets.filter((t) => !t.item && !pending[t.ticketId]), snapshot.floor.layout.machines, snapshot.serverTime) : []), [snapshot, pending]);
  const all = useMemo(() => (snapshot ? snapshot.tickets.filter((t) => !t.item) : []), [snapshot]);
  const groups = useMemo(() => groupTickets(all.filter((t) => matches(t, query)), machines ?? []), [all, machines, query]);
  const shown = needs.filter((n) => matches(n.ticket, query));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-4 pb-2 pt-2.5">
        <div className="flex self-start rounded-full border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] p-0.5" role="tablist" aria-label="Tickets">
          {([['needs', `Needs you ${needs.length}`], ['all', `All tickets ${all.length}`]] as const).map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={list === id} onClick={() => setList(id)}
              className={cn('min-h-9 rounded-full px-3.5 text-[13px] font-semibold', list === id ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-muted)]')}>{label}</button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Find a ticket" placeholder="Title, number, type, tag" enterKeyHint="search"
          className="min-h-11 w-full rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 text-[15px] text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)]" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}>
        {!snapshot && <Empty title="Reading the floor…" />}
        {snapshot && list === 'needs' && (shown.length
          ? shown.map((n) => <NeedCard key={n.ticket.ticketId} need={n} machine={n.ticket.machineId ? byId.get(n.ticket.machineId) ?? null : null} />)
          : <Empty title={query.trim() ? 'No ticket matches' : 'Nothing waits for you'} text={query.trim() ? 'Try a number or a word of its title.' : `The floor runs on its own: ${snapshot.running} ${snapshot.running === 1 ? 'run' : 'runs'} in progress.`} />)}
        {snapshot && list === 'all' && (groups.length
          ? groups.map((g) => <Group key={g.key} group={g} />)
          : <Empty title={query.trim() ? 'No ticket matches' : 'No ticket on the floor'} text={query.trim() ? 'Try a number or a word of its title.' : 'The + makes one, or brings one from Fleex.'} />)}
      </div>
    </div>
  );
}

function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 px-6 py-12 text-center">
      <b className="text-[15px] text-[var(--theme-text-primary)]">{title}</b>
      {text && <span className="text-[13px] text-[var(--theme-text-muted)]">{text}</span>}
    </div>
  );
}

/** A ticket that waits for someone: what it is, where it stands and for how long, what was last said, and its buttons. */
function NeedCard({ need, machine }: { need: Need; machine: MachineSpec | null }) {
  const t = need.ticket, info = t.info;
  const open = () => useMobileNavStore.getState().openTicket(t.ticketId, 'conversation');
  const word = useLastWord(t.ticketId, t.since, need.kind === 'decision' || need.kind === 'question');
  const said = need.kind === 'failed' ? t.note : need.kind === 'floor' ? 'It goes nowhere until it is put on a machine.' : need.kind === 'aside' ? 'Nothing runs on it there until it is put back.' : word?.body ?? '';
  return (
    <article className="flex shrink-0 flex-col gap-2.5 rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-3" aria-label={`#${info?.displayId ?? '?'} ${info?.title ?? ''}`}>
      <button type="button" onClick={open} className="flex flex-col gap-1.5 text-left">
        <span className="flex items-center gap-2">
          <NeedChip kind={need.kind} />
          <span className="ml-auto min-w-0 truncate text-[12px] tabular-nums text-[var(--theme-text-secondary)]">{need.where} · {span(need.waitMs)}</span>
        </span>
        <span className="flex items-start gap-2">
          <TicketToken info={info} size={20} className="mt-0.5" />
          <b className="min-w-0 text-[15px] font-semibold leading-snug text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-[12px] font-medium text-[var(--theme-text-muted)]">#{info?.displayId ?? '?'}</span>{info?.title ?? t.ticketId}</b>
        </span>
        {said && <span className={cn('line-clamp-2 text-[13px] text-[var(--theme-text-secondary)]', need.kind === 'failed' && 'font-mono text-[12px]')}>{said}</span>}
      </button>
      <TicketActsBar ticket={t} machine={machine} word={word} onReply={open} />
      {need.kind === 'floor' && <div className="flex gap-2"><button type="button" className={BTN.go} onClick={() => useMobileFactoryStore.getState().take(t.ticketId)}>Take</button></div>}
    </article>
  );
}

/** The tickets of one machine, under its name. A zone that still holds some lets them all out at once. */
function Group({ group }: { group: TicketGroup }) {
  const m = group.machine;
  const waiting = useMobileFactoryStore((s) => (m ? s.pending[m.id] : undefined));
  const pending = useMobileFactoryStore((s) => s.pending);
  return (
    <section className="flex shrink-0 flex-col" aria-label={group.title}>
      <div className="flex min-h-11 items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[3px] bg-[var(--theme-text-muted)]" style={group.hue ? { background: group.hue } : undefined} aria-hidden />
        <b className="min-w-0 truncate text-[14px] font-semibold text-[var(--theme-text-primary)]">{group.title}</b>
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-bold tracking-wider text-[var(--theme-text-muted)]">{group.word} · {group.tickets.length}</span>
        {m && waiting && <button type="button" className="min-h-11 shrink-0 px-2 text-[13px] font-semibold text-[var(--theme-accent)]" onClick={() => useMobileFactoryStore.getState().undo(m.id)}>Undo release</button>}
        {m && !waiting && group.held.length > 1 && (
          <button type="button" className="min-h-9 shrink-0 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] px-3 text-[12.5px] font-semibold text-[var(--theme-text-primary)]" onClick={() => gestures.releaseAll(m, group.held)}>Release all</button>
        )}
      </div>
      {group.tickets.map((t) => {
        const st = shortState(t, m), going = !!pending[t.ticketId] || (!!waiting && group.held.includes(t));
        return (
          <button key={t.ticketId} type="button" onClick={() => useMobileNavStore.getState().openTicket(t.ticketId, 'conversation')}
            className={cn('flex min-h-11 items-center gap-2.5 border-b border-[var(--theme-border-subtle)] text-left', going && 'opacity-50')}>
            <TicketToken info={t.info} size={18} />
            <span className="min-w-0 flex-1 truncate text-[14px] text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-[12px] text-[var(--theme-text-muted)]">#{t.info?.displayId ?? '?'}</span>{t.info?.title ?? t.ticketId}</span>
            <span className={cn('shrink-0 text-[12px]', going ? 'text-[var(--theme-text-muted)]' : st.needs ? 'font-semibold text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{going ? 'leaving…' : st.text}</span>
          </button>
        );
      })}
    </section>
  );
}

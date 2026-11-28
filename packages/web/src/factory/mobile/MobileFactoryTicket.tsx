import { useState } from 'react';
import { useTicketStore } from '../../stores/ticketStore';
import { cn } from '../../lib/cn';
import { tint } from '../../lib/tints';
import { useFactoryStore } from '../factoryStore';
import { span, since } from '../format';
import { standing } from '../needs';
import { useFactoryTicket } from '../useFactoryTicket';
import { BTN, TicketActsBar, useLastWord } from './MobileFactoryActs';
import { NeedChip } from './MobileFactoryTickets';
import { gestures, sendToFactory } from './gestures';
import { useMobileFactoryStore } from './mobileFactoryStore';
import { actsFor, askOf, hasActs } from './ticketActs';

/*
 * What a ticket of the floor carries with it on the phone's ticket screen (`MobileTicketDetail`), as the Work view's
 * does on the desktop (`FactoryContextGroup`, `FactoryThreadCard`, `FactoryHandover`). Each of the three renders
 * nothing while the Factory is off, and the first two nothing for a ticket that is not on the floor.
 */

/** Under the ticket's title: where it stands on the floor and what happens to it there. A tap shows it on the map. */
export function MobileFactoryWhere({ ticketId }: { ticketId: string }) {
  const seen = useFactoryTicket(ticketId);
  const now = useFactoryStore((s) => s.snapshot?.serverTime ?? '');
  if (!seen) return null;
  const { ticket, machine } = seen, { where, state } = standing(ticket, machine), ask = askOf(ticket, machine);
  const show = () => { useMobileFactoryStore.getState().showOnMap(ticketId); useTicketStore.getState().selectTicket(null); };
  return (
    <button type="button" onClick={show} aria-label={`On the Factory floor: ${where}. Show it on the map`}
      className="mx-4 mb-2 flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-left">
      <span className={cn('h-2 w-2 shrink-0 rounded-full', ask?.kind === 'failed' ? 'bg-[var(--theme-danger)]' : ask ? 'bg-[var(--theme-warning)]' : 'bg-[var(--theme-success)]')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-[var(--theme-text-primary)]"><span className="mr-1.5 font-mono text-[10px] font-bold tracking-wider text-[var(--theme-text-muted)]">FACTORY</span>{where}</span>
        <span className="block truncate text-[12px] text-[var(--theme-text-secondary)]">{state} · {span(since(ticket.since, now))}</span>
      </span>
      <span className="shrink-0 text-[13px] font-medium text-[var(--theme-accent)]">Map ›</span>
    </button>
  );
}

/**
 * At the foot of the ticket's conversation, above the composer: what the floor asks of someone, with its buttons (a
 * gate's decision and its optional reason, Run again or Leave as, Release), and Set aside for a ticket a station is
 * working on. A question is answered in the composer right under it: a plain reply gives the ticket back to the
 * station that asked. A Factory run creates no mention and no workflow step run, so nothing else on this screen says it.
 */
export function MobileFactoryAsk({ ticketId }: { ticketId: string }) {
  const seen = useFactoryTicket(ticketId);
  const ticket = seen?.ticket ?? null, machine = seen?.machine ?? null;
  const ask = ticket ? askOf(ticket, machine) : null;
  const word = useLastWord(ticketId, ticket?.since ?? '', ask?.kind === 'question');
  if (!ticket) return null;
  const acts = actsFor(ticket, machine);
  if (!ask && !hasActs(acts)) return null;
  const hue = ask?.kind === 'failed' ? 'red' : ask?.kind === 'aside' || ask?.kind === 'floor' ? 'gray' : ask ? 'yellow' : 'gray';
  return (
    <div className={cn('mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-2xl px-3 py-2.5', tint(hue))} role={ask ? 'alert' : 'group'} aria-label="Factory">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
        {ask ? <><NeedChip kind={ask.kind} /><span className="min-w-0 font-semibold">{ask.line}</span></> : <span className="font-semibold">{standing(ticket, machine).where} is working on it</span>}
      </div>
      {ask?.kind === 'failed' && ticket.note && <p className="break-words font-mono text-[12px] opacity-90">{ticket.note}</p>}
      {ask?.kind === 'question' && <p className="text-[12.5px] opacity-90">Reply below: your answer gives the ticket back to the station.</p>}
      <TicketActsBar ticket={ticket} machine={machine} full word={word} />
      {ask?.kind === 'floor' && <div className="flex gap-2"><button type="button" className={BTN.go} onClick={() => { useMobileFactoryStore.getState().take(ticketId); useTicketStore.getState().selectTicket(null); }}>Take</button></div>}
    </div>
  );
}

/**
 * At the foot of the ticket's context: who drives it. A ticket Fleex drives is sent to the Factory, where it lands in
 * Inbound; one the Factory drives is taken in hand to be put elsewhere on the floor, or taken back.
 */
export function MobileFactoryHandover({ ticketId, displayId, status }: { ticketId: string; displayId: number; status: string }) {
  const enabled = useFactoryStore((s) => s.enabled), managed = useFactoryStore((s) => s.managed.has(ticketId));
  const ticket = useFactoryStore((s) => s.snapshot?.tickets.find((t) => t.ticketId === ticketId) ?? null);
  const waiting = useMobileFactoryStore((s) => s.pending[ticketId]);
  const [busy, setBusy] = useState(false);
  if (!enabled) return null;
  const closed = status === 'done' || status === 'cancelled';
  const head = <h2 className="pb-1.5 pt-4 text-[10.5px] font-semibold tracking-[0.06em] text-[var(--theme-text-muted)]">FACTORY</h2>;
  if (!managed) {
    return (
      <div role="group" aria-label="Who drives this ticket">
        {head}
        <div className="flex"><button type="button" className={BTN.plain} disabled={busy || closed} onClick={() => { setBusy(true); void sendToFactory(ticketId, `#${displayId}`).finally(() => setBusy(false)); }}>Send to Factory</button></div>
        <p className="mt-1.5 text-[12px] text-[var(--theme-text-faint)]">{closed ? 'A ticket that is done or cancelled has nothing left to go through.' : 'It lands in the Inbound zone of the floor and waits there. From then on its status and what runs on it are driven from the floor.'}</p>
      </div>
    );
  }
  return (
    <div role="group" aria-label="Who drives this ticket">
      {head}
      {waiting ? (
        <p className="text-[13px] text-[var(--theme-text-secondary)]" role="status">{waiting.label} <button type="button" className="min-h-11 px-2 font-semibold text-[var(--theme-accent)]" onClick={() => useMobileFactoryStore.getState().undo(ticketId)}>Undo</button></p>
      ) : (
        <div className="flex gap-2">
          <button type="button" className={BTN.plain} disabled={!ticket} onClick={() => { useMobileFactoryStore.getState().take(ticketId); useTicketStore.getState().selectTicket(null); }}>Take</button>
          <button type="button" className={BTN.ghost} disabled={!ticket} onClick={() => { if (ticket) gestures.giveBack(ticket); }}>Take back from Factory</button>
        </div>
      )}
      <p className="mt-1.5 text-[12px] text-[var(--theme-text-faint)]">Take: put it on another machine of the floor, on the map. Take back: it leaves the floor and is an ordinary ticket again, in the status it has{ticket?.phase === 'running' ? '; the run in progress is left to finish, and its result is ignored' : ''}.</p>
    </div>
  );
}

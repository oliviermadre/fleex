import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { useTicketStore } from '../stores/ticketStore';
import { useFactoryStore } from './factoryStore';
import { since, span } from './format';
import { Star, TicketGlyphs } from './FactoryTicketMeta';
import { needsHuman, type FactoryTicket } from './types';

export interface TicketTipHandle {
  /** Show the card for a ticket next to a point given in the floor's own pixels. */
  show(ticketId: string, x: number, y: number): void;
  hide(): void;
}

const PHASE: Record<FactoryTicket['phase'], string> = {
  loose: 'lying on the floor', belt: 'on a belt', arm: 'in an arm', wait: 'queueing to run', running: 'running', review: 'waiting for your decision',
  question: 'the agent asked a question', failed: 'the run failed', aside: 'set aside by you', out: 'done, waiting for an arm', zone: 'waiting', port: 'in a teleporter',
};

/**
 * What a ticket is, the moment the pointer is over it: no click needed. The
 * floor calls `show` and `hide` as the pointer moves, so only this card
 * re-renders, not the page around it.
 */
export const FactoryTicketTip = forwardRef<TicketTipHandle>(function FactoryTicketTip(_, ref) {
  const [at, setAt] = useState<{ id: string; x: number; y: number } | null>(null);
  const el = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({
    show: (id, x, y) => setAt((cur) => (cur && cur.id === id && Math.abs(cur.x - x) < 2 && Math.abs(cur.y - y) < 2 ? cur : { id, x, y })),
    hide: () => setAt(null),
  }), []);
  const ticket = useFactoryStore((s) => (at ? s.snapshot?.tickets.find((t) => t.ticketId === at.id) ?? null : null));
  const machine = useFactoryStore((s) => (ticket?.machineId ? s.layout?.machines.find((m) => m.id === ticket.machineId) ?? null : null));
  const now = useFactoryStore((s) => s.snapshot?.serverTime ?? '');
  const board = useTicketStore((s) => (ticket?.info ? s.boards.find((b) => b.id === ticket.info!.boardId)?.name ?? null : null));

  // Keep the card inside the floor: it flips to the other side of the pointer near an edge.
  useLayoutEffect(() => {
    const node = el.current, host = node?.parentElement;
    if (!node || !host || !at) return;
    const w = node.offsetWidth, h = node.offsetHeight;
    const left = at.x + 16 + w > host.clientWidth ? Math.max(4, at.x - 12 - w) : at.x + 16;
    const top = at.y + 16 + h > host.clientHeight ? Math.max(4, at.y - 12 - h) : at.y + 16;
    node.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  });

  if (!at || !ticket) return null;
  const info = ticket.info, why = needsHuman(ticket);
  const where = machine ? (machine.kind === 'belt' || machine.kind === 'arm' || machine.kind === 'bridge' ? '' : machine.name || machine.kind) : '';
  return (
    <div ref={el} role="tooltip" className="pointer-events-none absolute left-0 top-0 z-10 flex w-max max-w-[340px] flex-col gap-1.5 rounded-lg border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] px-3 py-2 shadow-xl">
      <div className="flex items-start gap-1.5 text-sm font-semibold leading-snug text-[var(--theme-text-primary)]">
        <span className="flex-none font-mono text-xs font-normal leading-5 text-[var(--theme-text-muted)]">#{info?.displayId ?? '?'}</span>
        <span className="line-clamp-3 min-w-0">{info?.title ?? ticket.ticketId}</span>
        {info?.favorite && <Star on className="mt-1" />}
      </div>
      <TicketGlyphs info={info ? { ...info, favorite: false } : null} words className="text-[11px] text-[var(--theme-text-secondary)]" />
      <div className="text-[11px] text-[var(--theme-text-secondary)]">
        <span className={why ? 'text-[var(--theme-warning)]' : undefined}>{where ? `${where} · ` : ''}{ticket.phase === 'zone' && ticket.released ? 'released, waiting for an arm' : PHASE[ticket.phase]}</span>
        {now && <span className="text-[var(--theme-text-muted)]"> · here for {span(since(ticket.since, now))}</span>}
      </div>
      <div className="text-[11px] text-[var(--theme-text-muted)]">
        {board ? `${board} · ` : ''}{info?.status ?? ''}{now && ticket.handedAt ? ` · on the floor for ${span(since(ticket.handedAt, now))}` : ''}{ticket.outcome ? ` · last outcome “${ticket.outcome}”` : ''}
      </div>
      {ticket.note && <div className="text-[11px] text-[var(--theme-warning)]">{ticket.note}</div>}
      {info && info.tags.length > 0 && <div className="flex flex-wrap gap-1">{info.tags.slice(0, 6).map((tag) => <span key={tag} className="rounded border border-[var(--theme-border-input)] px-1 text-[10px] text-[var(--theme-text-secondary)]">{tag}</span>)}</div>}
    </div>
  );
});

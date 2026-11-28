import { useEffect, useState } from 'react';
import type { AgentQuestion, TicketComment } from '@fleex/shared';
import { fetchTicketComments } from '../../services/api';
import { formatQuestionAnswer } from '../../components/work/task/questionAnswer';
import { cn } from '../../lib/cn';
import type { FactoryTicket, MachineSpec } from '../types';
import { actsFor } from './ticketActs';
import { gestures } from './gestures';
import { useMobileFactoryStore } from './mobileFactoryStore';

/** A button of the phone's Factory: 44 px high, the size of a thumb. */
const B = 'flex min-h-11 min-w-0 flex-1 items-center justify-center break-words rounded-xl border px-3 text-center text-[13px] font-semibold leading-tight active:opacity-80 disabled:opacity-50';
export const BTN = {
  plain: cn(B, 'border-[var(--theme-border-input)] bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]'),
  go: cn(B, 'border-transparent bg-[var(--theme-success)] text-[var(--theme-bg-base)]'),
  accent: cn(B, 'border-transparent bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]'),
  ghost: cn(B, 'border-[var(--theme-border)] bg-transparent font-medium text-[var(--theme-text-secondary)]'),
};

/** What an agent last said in a ticket's thread, and the closed questions it declared with it. */
export interface LastWord { body: string; questions: AgentQuestion[] | null }
const said = new Map<string, LastWord | null>();
/** Test hook: forget what was read of the threads. */
export const forgetLastWords = (): void => said.clear();

/**
 * The agent's last comment on a ticket, read once per time the ticket came where it stands (`since`): the question it
 * asks, or what it concluded before a gate. Null while it is read, or when no agent wrote.
 */
export function useLastWord(ticketId: string, since: string, wanted: boolean): LastWord | null {
  const key = `${ticketId}:${since}`;
  const [word, setWord] = useState<LastWord | null>(() => said.get(key) ?? null);
  useEffect(() => {
    if (!wanted) return;
    if (said.has(key)) { setWord(said.get(key) ?? null); return; }
    let live = true;
    void fetchTicketComments(ticketId).then((comments: TicketComment[]) => {
      const last = [...comments].reverse().find((c) => c.authorType === 'agent');
      const found = last ? { body: last.body.trim(), questions: last.questions?.length ? last.questions : null } : null;
      said.set(key, found);
      if (live) setWord(found);
    }).catch(() => { /* the card says where to read it */ });
    return () => { live = false; };
  }, [ticketId, key, wanted]);
  return wanted ? word : null;
}

/**
 * What one does on a ticket, as buttons: a gate's outcomes, an agent's closed choices, Run again and Leave as, Release,
 * Set aside. The same on its card in the list, in its sheet on the map and at the foot of its screen (`full`: with the
 * gate's optional reason, and the reply left to the composer under it). Every gesture goes through the undo window;
 * while one waits, the buttons give way to what it will do.
 */
export function TicketActsBar({ ticket, machine, full = false, word = null, onReply }: {
  ticket: FactoryTicket; machine: MachineSpec | null; full?: boolean;
  /** The agent's last comment, when its card read it: its closed choices become buttons. */
  word?: LastWord | null;
  /** Open the ticket's conversation to write an answer (a card or a sheet; the ticket's own screen has its composer). */
  onReply?: () => void;
}) {
  const waiting = useMobileFactoryStore((s) => s.pending[ticket.ticketId]);
  const undo = useMobileFactoryStore((s) => s.undo);
  const [leaving, setLeaving] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => { setLeaving(false); setReason(''); }, [ticket.ticketId, ticket.phase]);
  const a = actsFor(ticket, machine);

  if (waiting) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-[var(--theme-border)] px-3 py-2 text-[12.5px] text-[var(--theme-text-secondary)]" role="status">
        <span className="min-w-0 flex-1">{waiting.label}</span>
        <button type="button" className="min-h-11 shrink-0 px-2 text-sm font-semibold text-[var(--theme-accent)]" onClick={() => undo(ticket.ticketId)}>Undo</button>
      </div>
    );
  }

  /* one closed question: its options are the answer; several, or none, are answered in words */
  const one = a.answer && word?.questions?.length === 1 ? word.questions : null;
  const rows: React.ReactNode[] = [];
  if (a.decide.length) {
    if (full) rows.push(
      <textarea key="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason" placeholder="Reason (optional), kept in the thread"
        className="w-full resize-none rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-3 py-2 text-[14px] text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)]" />,
    );
    /* two a row: an outcome's name is not cut */
    for (let i = 0; i < a.decide.length; i += 2) rows.push(
      <div key={`decide-${i}`} className="flex gap-2">
        {a.decide.slice(i, i + 2).map((o, k) => <button key={o} type="button" className={i + k === 0 ? BTN.go : BTN.plain} onClick={() => gestures.decide(ticket, machine, o, reason)}>{o}</button>)}
      </div>,
    );
  }
  if (one) rows.push(
    <div key="choices" className="flex flex-wrap gap-2">
      {one[0]!.options.map((o) => <button key={o} type="button" className={cn(BTN.plain, 'basis-[30%]')} onClick={() => gestures.answer(ticket, formatQuestionAnswer(one, [o]))}>{o}</button>)}
    </div>,
  );
  if (a.answer && onReply) rows.push(<div key="reply" className="flex gap-2"><button type="button" className={one ? BTN.ghost : BTN.accent} onClick={onReply}>{one ? 'Answer in words' : 'Answer'}</button></div>);
  /* a question on its card is answered; putting it back another way is on the ticket's own screen */
  if (a.again && (full || !a.answer)) {
    rows.push(
      <div key="again" className="flex gap-2">
        <button type="button" className={a.answer ? BTN.plain : BTN.go} onClick={() => gestures.again(ticket, machine)}>Run again</button>
        {a.leaveAs.length > 0 && <button type="button" className={BTN.plain} aria-expanded={leaving} onClick={() => setLeaving((v) => !v)}>Leave as…</button>}
      </div>,
    );
    if (leaving) rows.push(
      <div key="leave" className="flex flex-wrap gap-2" role="group" aria-label="Leave as">
        {a.leaveAs.map((o) => <button key={o} type="button" className={cn(BTN.plain, 'basis-[30%]')} onClick={() => gestures.leaveAs(ticket, machine, o)}>{o}</button>)}
      </div>,
    );
  }
  if (a.release) rows.push(<div key="release" className="flex gap-2"><button type="button" className={BTN.go} onClick={() => gestures.release(ticket, machine)}>Release</button></div>);
  if (a.aside) rows.push(<div key="aside" className="flex gap-2"><button type="button" className={BTN.plain} onClick={() => gestures.aside(ticket, machine)}>Set aside</button></div>);
  if (!rows.length) return null;
  return <div className="flex flex-col gap-2">{rows}</div>;
}

/**
 * What one can do on a ticket of the floor from the phone, read from where it stands: the same rules as the command
 * card of the page (`factoryMenu.ts`) and the Factory group of a ticket's context (`FactoryContextGroup.tsx`), as
 * plain data, so the card of a ticket, its sheet on the map and the foot of its screen all offer the same.
 */
import { canSetAside, QUESTION_OUTCOME, RUNS, SET_ASIDE, type FactoryTicket, type MachineSpec, type StationSpec } from '../types';
import { needKind, type NeedKind } from '../needs';

export interface TicketActs {
  /** At a gate: the ways it can be decided, the first one the usual one. */
  decide: string[];
  /** Set aside in its station (a question, a failed run, a human took it): the station can run on it again… */
  again: boolean;
  /** …or it can leave by the arm of one of these outcomes, as if the station had concluded it. */
  leaveAs: string[];
  /** Held in a zone: an arm takes it out once it is released. */
  release: boolean;
  /** A station is working on it: it can be taken off its hands (a run in progress is stopped). */
  aside: boolean;
  /** An agent asked a question: a reply in its thread is the answer. */
  answer: boolean;
}

const station = (m: MachineSpec | null | undefined): StationSpec | null => (m?.kind === 'station' ? m : null);

export function actsFor(t: FactoryTicket, m: MachineSpec | null | undefined): TicketActs {
  const s = station(m), setAside = !!s && RUNS.includes(s.exec) && SET_ASIDE.includes(t.phase);
  return {
    decide: t.phase === 'review' && s ? s.outcomes : [],
    again: setAside,
    leaveAs: setAside && s ? s.outcomes : [],
    release: t.phase === 'zone' && !t.released,
    aside: canSetAside(t, m),
    answer: t.phase === 'question' || t.outcome === QUESTION_OUTCOME,
  };
}

/** Whether anything at all is offered on it there, besides taking it in hand or taking it back. */
export const hasActs = (a: TicketActs): boolean => a.decide.length > 0 || a.again || a.release || a.aside || a.answer;

const nameOf = (m: MachineSpec | null | undefined): string => {
  const s = station(m);
  return (m && 'name' in m && m.name) || (s ? (s.exec === 'human_gate' ? 'The gate' : 'The station') : m?.kind === 'zone' ? 'Its zone' : 'The floor');
};

/** What the floor expects of someone about a ticket, in one line; null when it expects nothing. */
export function askOf(t: FactoryTicket, m: MachineSpec | null | undefined): { kind: NeedKind; line: string } | null {
  const kind = needKind(t) ?? (t.phase === 'zone' && m?.kind === 'zone' && m.needsYou ? 'zone' : null);
  if (!kind) return null;
  const name = nameOf(m);
  const line = kind === 'decision' ? `${name} waits for your decision`
    : kind === 'failed' ? `${name}: the run failed`
    : kind === 'aside' ? `Set aside in ${name}: put it back, or send it out`
    : kind === 'floor' ? 'It lies on the floor, and goes nowhere until it is put on a machine'
    : kind === 'zone' ? `${name}: release it when your part is done`
    : t.phase === 'question' ? `${name} asked you a question` : 'An agent asked you a question';
  return { kind, line };
}

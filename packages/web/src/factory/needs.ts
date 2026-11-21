/**
 * The tickets that wait for someone, and what each waits for: a decision at a gate, an answer to an agent, a look at
 * a failed run, a ticket a human set aside and has to put back, one lying on the floor. Longest wait first.
 * This is the list shown top-left on the floor, and what the left and right arrows walk.
 */
import { portName } from './teleport';
import { QUESTION_OUTCOME, type FactoryTicket, type MachineSpec } from './types';

export type NeedKind = 'decision' | 'question' | 'failed' | 'aside' | 'floor';
export interface Need { ticket: FactoryTicket; kind: NeedKind; where: string; waitMs: number }
export const NEED_LABEL: Record<NeedKind, string> = { decision: 'decision', question: 'question', failed: 'run failed', aside: 'set aside by you', floor: 'on the floor' };

export function needKind(t: FactoryTicket): NeedKind | null {
  if (t.phase === 'review') return 'decision';
  if (t.phase === 'failed') return 'failed';
  if (t.phase === 'aside') return 'aside';
  /* an unanswered question travels with its ticket (an arm that takes questions) until a station takes it again */
  if (t.phase === 'question' || t.outcome === QUESTION_OUTCOME) return 'question';
  if (t.phase === 'loose') return 'floor';
  return null;
}

const placeOf = (m: MachineSpec | undefined): string => !m ? 'Floor' : m.kind === 'belt' || m.kind === 'bridge' ? 'On a belt' : m.kind === 'arm' ? 'In an arm' : m.kind === 'teleporter' ? portName(m)
  : m.name || (m.kind === 'station' ? (m.exec === 'human_gate' ? 'Gate' : 'Station') : m.kind === 'zone' ? 'Zone' : m.kind === 'desk' ? 'Desk' : m.kind === 'intake' ? 'Intake' : 'Exit');

/** Where a ticket is and what happens to it there, in words: the two lines of the Factory group in a ticket's context. */
export function standing(t: FactoryTicket, m: MachineSpec | null | undefined): { where: string; state: string } {
  const out = t.outcome && t.outcome !== QUESTION_OUTCOME ? ` as ${t.outcome}` : '';
  const state = t.phase === 'review' ? 'Waiting for your decision'
    : t.phase === 'failed' ? 'The run failed'
    : t.phase === 'aside' ? 'Set aside by you'
    : t.phase === 'question' ? 'Asked you a question'
    : t.phase === 'running' ? 'Running'
    : t.phase === 'wait' ? t.note || 'Waiting to start'
    : t.phase === 'out' ? `Done${out}, waiting to be taken`
    : t.phase === 'loose' ? 'Lying there until it is put on a machine'
    : t.outcome === QUESTION_OUTCOME ? 'Carries a question for you'
    : t.phase === 'port' ? 'In a teleporter'
    : t.phase === 'zone' ? 'Kept there' : 'On its way';
  return { where: placeOf(m ?? undefined), state };
}

export function needsOf(tickets: readonly FactoryTicket[], machines: readonly MachineSpec[], now: string): Need[] {
  const byId = new Map(machines.map((m) => [m.id, m])), at = Date.parse(now) || 0, out: Need[] = [];
  for (const t of tickets) {
    const kind = needKind(t);
    if (!kind) continue;
    const since = Date.parse(t.since);
    out.push({ ticket: t, kind, where: placeOf(t.machineId ? byId.get(t.machineId) : undefined), waitMs: at && since ? Math.max(0, at - since) : 0 });
  }
  return out.sort((a, b) => b.waitMs - a.waitMs || a.ticket.ticketId.localeCompare(b.ticket.ticketId));
}

/** The ticket before or after one in the list, round and round; the first (or the last) when that one is not in it. */
export function stepNeed(needs: readonly Need[], current: string | null, dir: 1 | -1): string | null {
  if (!needs.length) return null;
  const i = needs.findIndex((n) => n.ticket.ticketId === current);
  return needs[i < 0 ? (dir > 0 ? 0 : needs.length - 1) : (i + dir + needs.length) % needs.length]!.ticket.ticketId;
}

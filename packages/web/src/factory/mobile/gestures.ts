/**
 * The gestures of the phone on the floor. Each one says what it does in a line, hides what it acts on, and is sent
 * once its undo window has closed (`mobileFactoryStore.commit`); the page's own answer then brings the new floor.
 */
import { postTicketComment } from '../../services/api';
import { toast } from '../../lib/toast';
import { useFactoryStore } from '../factoryStore';
import type { FactoryTicket, MachineSpec, Target } from '../types';
import { useMobileFactoryStore } from './mobileFactoryStore';

const tag = (t: FactoryTicket): string => `#${t.info?.displayId ?? '?'}`;
const at = (m: MachineSpec | null | undefined, fallback: string): string => (m && 'name' in m && m.name) || fallback;
const commit = (key: string, label: string, run: () => Promise<unknown> | void) => useMobileFactoryStore.getState().commit(key, label, run);
const floor = () => useFactoryStore.getState();

export const gestures = {
  /** A gate's decision, with the reason given (kept in the ticket's thread). */
  decide: (t: FactoryTicket, m: MachineSpec | null, outcome: string, reason = '') =>
    commit(t.ticketId, `${tag(t)} leaves ${at(m, 'the gate')} as ${outcome}${reason.trim() ? ', with your reason' : ''}`, () => floor().resolve(t.ticketId, outcome, reason.trim())),
  again: (t: FactoryTicket, m: MachineSpec | null) => commit(t.ticketId, `${tag(t)}: ${at(m, 'its station')} runs on it again`, () => floor().putBack(t.ticketId)),
  leaveAs: (t: FactoryTicket, m: MachineSpec | null, outcome: string) => commit(t.ticketId, `${tag(t)} leaves ${at(m, 'its station')} as ${outcome}`, () => floor().putBack(t.ticketId, outcome)),
  release: (t: FactoryTicket, m: MachineSpec | null) => commit(t.ticketId, `${tag(t)} released from ${at(m, 'its zone')}`, () => floor().release(t.ticketId)),
  /** Every ticket a zone still holds, as one gesture: one line, one Undo. */
  releaseAll: (m: MachineSpec, held: readonly FactoryTicket[]) => {
    if (!held.length) return;
    commit(m.id, `${held.length} released from ${at(m, 'the zone')}`, async () => { for (const t of held) await floor().release(t.ticketId); });
  },
  aside: (t: FactoryTicket, m: MachineSpec | null) => commit(t.ticketId, `${tag(t)} set aside in ${at(m, 'its station')}${t.phase === 'running' ? ': its run is stopped' : ''}`, () => floor().setAside(t.ticketId)),
  /** Take it back from the Factory: Fleex drives it again, in the status it has. */
  giveBack: (t: FactoryTicket) => commit(t.ticketId, `${tag(t)} taken back: Fleex drives it again`, () => floor().giveBack(t.ticketId)),
  /** Put down the ticket in hand. */
  put: (t: FactoryTicket, target: Target, where: string) => commit(t.ticketId, `${tag(t)} ${where}`, () => floor().move(t.ticketId, target)),
  /** A reply to the agent's question: a comment in the thread, which gives the ticket back to the station that asked. */
  answer: (t: FactoryTicket, body: string) =>
    commit(t.ticketId, `${tag(t)} answered: ${body.length > 40 ? `${body.slice(0, 39)}…` : body}`, () =>
      postTicketComment(t.ticketId, body).catch((err: unknown) => { toast.error(`Not sent to ${tag(t)}`, { detail: err instanceof Error ? err.message : String(err) }); })),
};

/** Send a ticket Fleex drives to the Factory: it lands in Inbound. Sent at once: taking it back undoes it. */
export async function sendToFactory(ticketId: string, label: string): Promise<void> {
  await floor().transfer(ticketId, {});
  if (floor().managed.has(ticketId)) toast.success(`${label} sent to the Factory`, { detail: 'It waits in Inbound to be released' });
}

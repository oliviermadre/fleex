/**
 * The commands of the talk line: typed after a slash, they act on whoever the line talks to. A ticket's are those of
 * its command card that make sense where it stands (run its station again, stop it, release it, open it, star it, give
 * it back); the assistant's start a new conversation. The line lists the ones that apply as you type.
 */
import type { TicketPhase } from './types';

/** What a command needs to know of a ticket, and what it can do to it. */
export interface CommandTicket {
  ticketId: string; label: string; phase?: TicketPhase; released?: boolean; favorite?: boolean | null; canAside?: boolean;
}
export interface CommandActs {
  retry(id: string): Promise<void>; setAside(id: string): Promise<void>; release(id: string): Promise<void>;
  star(id: string, on: boolean): Promise<void>; giveBack(id: string): Promise<void>; open(id: string): void;
  newConversation(): void;
}
export interface TalkCommand { name: string; help: string; run(acts: CommandActs): Promise<string> | string }

const AGAIN: readonly TicketPhase[] = ['failed', 'question', 'aside'];
/** A give back is typed twice: the first one says what it does. */
let armedGiveBack: string | null = null;

export function commandsFor(target: { kind: 'assistant' } | ({ kind: 'ticket' } & CommandTicket)): TalkCommand[] {
  if (target.kind === 'assistant') {
    return [{ name: 'new', help: 'Start a new conversation with the assistant', run: (a) => { a.newConversation(); return 'The next question starts a new conversation'; } }];
  }
  const t = target, out: TalkCommand[] = [];
  if (t.phase && AGAIN.includes(t.phase)) out.push({ name: 'run', help: 'Run its station again', run: async (a) => { await a.retry(t.ticketId); return `${t.label}: its station runs again`; } });
  if (t.canAside) out.push({ name: 'stop', help: 'Stop the run and keep it in its station until you put it back', run: async (a) => { await a.setAside(t.ticketId); return `${t.label}: stopped, kept in its station`; } });
  if (t.phase === 'zone' && !t.released) out.push({ name: 'release', help: 'Let an arm take it out of its zone', run: async (a) => { await a.release(t.ticketId); return `${t.label}: released`; } });
  out.push({ name: 'open', help: 'Open the ticket: its thread and its actions', run: (a) => { a.open(t.ticketId); return ''; } });
  if (t.favorite !== null && t.favorite !== undefined) {
    out.push({ name: t.favorite ? 'unstar' : 'star', help: t.favorite ? 'Remove it from your favourites' : 'Make it a favourite: it carries its name on the floor', run: async (a) => { await a.star(t.ticketId, !t.favorite); return `${t.label}: ${t.favorite ? 'no longer a favourite' : 'a favourite'}`; } });
  }
  out.push({
    name: 'giveback', help: 'Take it out of the Factory (type it twice)', run: async (a) => {
      if (armedGiveBack !== t.ticketId) { armedGiveBack = t.ticketId; return `${t.label}: type /giveback again to take it out of the Factory`; }
      armedGiveBack = null; await a.giveBack(t.ticketId); return `${t.label}: given back, out of the Factory`;
    },
  });
  return out;
}

/** `/run now` → `run`; anything that does not start with a slash is no command. */
export const commandName = (text: string): string | null => (/^\/(\S*)/.exec(text.trim())?.[1] ?? null);

/** The commands that start with what is typed after the slash, in their order. */
export const matching = (list: TalkCommand[], typed: string): TalkCommand[] => list.filter((c) => c.name.startsWith(typed.toLowerCase()));

/** Test seam. */
export function resetCommands(): void { armedGiveBack = null; }

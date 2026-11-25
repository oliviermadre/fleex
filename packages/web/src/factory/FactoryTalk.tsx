import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TicketComment } from '@fleex/shared';
import { formatQuestionAnswer } from '../components/work/task/questionAnswer';
import { FloorLine } from '../components/ui/toast/Toaster';
import { toast, useToastHistory, type ToastItem } from '../lib/toast';
import { cn } from '../lib/cn';
import { fetchTicketComments, postTicketComment } from '../services/api';
import { useFactoryStore } from './factoryStore';
import type { TicketPhase } from './types';
import { commandName, commandsFor, matching, type CommandActs } from './talkCommands';
import { appWs } from '../services/websocket';
import { useAssistantStore } from '../stores/assistantStore';

/**
 * Enter on the floor: a line to talk over the console, under the last messages (picked on
 * `docs/factory/floor-messages.html`). Who it talks to is written at its start and Tab changes it: the assistant,
 * or a ticket (the one selected, or the first that needs you). To a ticket, it is a comment in its thread, as you; if
 * the ticket waits on a question, that is the answer and its station runs again. Replies come back as toasts, so they
 * fade over the floor like any message and stay in the log.
 */

/** A ticket the line can talk to: what it is called, and where it stands (a question, a failed run, a gate's decision). */
export interface TalkTicket { ticketId: string; label: string; phase?: TicketPhase; station?: string; note?: string; released?: boolean; favorite?: boolean | null; canAside?: boolean }
export type TalkTarget = { kind: 'assistant' } | ({ kind: 'ticket' } & TalkTicket);
/** What was said from the line, kept in the log with the toasts. */
interface Said { at: number; to: string; text: string }

const SESSION_KEY = 'fleex.factory.assistantSession';
const readSession = (): string | null => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };
const writeSession = (id: string) => { try { localStorage.setItem(SESSION_KEY, id); } catch { /* none */ } };
/** Said once, at the start of the Factory's conversation: the answer is read in a one-line log. */
const FLOOR_PREAMBLE = 'I am on the Factory floor of Fleex. Answer in two or three sentences: I read you in a one-line log over the floor.\n\n';
const short = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, ' ').trim();

/**
 * A ticket a station set aside writes to you in the log (picked on `docs/factory/ticket-talk.html`): its agent's
 * question, with its closed choices as replies to click (a reply is the answer: the station runs again), or its failed
 * run, with Run again. Once per time it is set aside; the line then opens on it. A gate does not write: its decision
 * is on its buttons.
 */
export async function announceTicket(t: TalkTicket, onOpen: (ticketId: string) => void, since: string): Promise<void> {
  if (t.phase !== 'question' && t.phase !== 'failed') return;
  const key = `${t.ticketId}:${since}`;
  if (talkLog.announced.has(key)) return;
  talkLog.announced.add(key);
  talkLog.lastSpoke = t; talkLog.last = 'ticket'; talkLog.tickets.set(t.ticketId, t.label);
  const from = `From ${t.label}${t.station ? ` · ${t.station}` : ''}`;
  const open = { label: 'Open', onClick: () => onOpen(t.ticketId) };
  if (t.phase === 'failed') {
    toast.show({ tone: 'error', title: from, message: `The run failed${t.note ? `: ${short(t.note, 200)}` : ''}`, durationMs: 30_000,
      choices: [{ label: 'Run again', onClick: () => { void useFactoryStore.getState().retry(t.ticketId); } }], action: open });
    return;
  }
  /* the question is the agent's last comment in the thread, with the closed choices it declared */
  const comments = await fetchTicketComments(t.ticketId).catch(() => [] as TicketComment[]);
  const asked = [...comments].reverse().find((c) => c.authorType === 'agent');
  const one = asked?.questions?.length === 1 ? asked.questions : null;
  toast.show({
    tone: 'action', title: from, message: asked ? short(asked.body, 400) : 'It asked you a question: read it in its thread.', durationMs: 30_000,
    choices: one ? one[0]!.options.map((o) => ({ label: o, onClick: () => answer(t, formatQuestionAnswer(one, [o])) })) : undefined,
    action: open,
  });
}

/** A reply to a ticket, from the line or a choice: a comment from you in its thread, kept in the log. */
function answer(t: TalkTicket, body: string): void {
  talkLog.said = [...talkLog.said, { at: Date.now(), to: t.label, text: body }].slice(-50);
  talkLog.last = 'ticket'; talkLog.tickets.set(t.ticketId, t.label);
  void postTicketComment(t.ticketId, body).catch((err: unknown) => toast.error(`Not sent to ${t.label}`, { detail: err instanceof Error ? err.message : String(err) }));
  talkLog.onSaid?.();
}

/**
 * The targets Tab goes through, the first one the line opens on: the ticket given (selected, or the last that wrote),
 * then every other ticket that needs you, in the list's order, and the assistant; the assistant first when it was the
 * last talked to.
 */
export function talkTargets(ticket: TalkTicket | null, last: 'assistant' | 'ticket', others: readonly TalkTicket[] = []): TalkTarget[] {
  const a: TalkTarget = { kind: 'assistant' }, seen = new Set<string>(), tickets: TalkTarget[] = [];
  for (const t of [...(ticket ? [ticket] : []), ...others]) if (!seen.has(t.ticketId)) { seen.add(t.ticketId); tickets.push({ kind: 'ticket', ...t }); }
  return last === 'assistant' ? [a, ...tickets] : [...tickets, a];
}

/**
 * Ask the assistant in the Factory's own conversation (made once, kept), and hand its answer back once it is done.
 * Its streaming text lands in the assistant store; the answer is the last assistant text after the question, once the
 * conversation is idle again.
 */
function askAssistant(text: string, onAnswer: (answer: string, sessionId: string) => void): void {
  const store = useAssistantStore.getState();
  store.ensureConnected();
  const known = readSession();
  const go = (id: string, first: boolean) => {
    const before = (useAssistantStore.getState().itemsBySession[id] ?? []).length;
    const send = () => { useAssistantStore.getState().sendUser(first ? FLOOR_PREAMBLE + text : text); watch(); };
    const watch = () => {
      const unsub = useAssistantStore.subscribe((s) => {
        const items = s.itemsBySession[id] ?? [], status = s.sessions.find((x) => x.id === id)?.status;
        const last = items[items.length - 1];
        if (items.length > before + 1 && last?.kind === 'assistant' && status === 'idle') { unsub(); onAnswer(last.text, id); }
        if (status === 'awaiting_input') { unsub(); onAnswer('It asks to run a command: approve it in the Assistant.', id); }
      });
    };
    if (useAssistantStore.getState().activeId === id) send();
    else {
      useAssistantStore.getState().openSession(id);
      const unsub = useAssistantStore.subscribe((s) => { if (s.activeId === id && s.itemsBySession[id]) { unsub(); send(); } });
    }
  };
  if (known && store.sessions.some((s) => s.id === known)) { go(known, false); return; }
  /* a conversation of its own, made on the first question and named for what it is */
  const had = new Set(store.sessions.map((s) => s.id));
  store.newSession();
  const unsub = useAssistantStore.subscribe((s) => {
    if (!s.activeId || had.has(s.activeId)) return;
    unsub();
    writeSession(s.activeId);
    useAssistantStore.getState().renameSession(s.activeId, 'Factory floor');
    go(s.activeId, true);
  });
}

export function FactoryTalk({ ticket, others = [], onClose, onOpenTicket, style }: {
  /** The ticket the line opens on: the one selected, else the last that wrote, else the first that needs you; null when there is none. */
  ticket: TalkTicket | null;
  /** The other tickets Tab reaches: those that need you. */
  others?: readonly TalkTicket[];
  onClose: () => void; onOpenTicket: (ticketId: string) => void;
  style?: React.CSSProperties;
}) {
  const navigate = useNavigate();
  const history = useToastHistory();
  const [said, setSaid] = useState<Said[]>(() => talkLog.said);
  const [text, setText] = useState('');
  /* the floor is read again every few seconds: the list follows it, and Tab keeps to the one it is on */
  const targets = useMemo(() => talkTargets(ticket, talkLog.last, others), [ticket, others]);
  const [onId, setOnId] = useState<string | null>(null);
  const idOf = (t: TalkTarget) => (t.kind === 'assistant' ? 'assistant' : t.ticketId);
  const target = targets.find((t) => idOf(t) === onId) ?? targets[0]!;
  const setAt = (step: (n: number) => number) => { const i = targets.indexOf(target); setOnId(idOf(targets[step(i) % targets.length]!)); };
  const input = useRef<HTMLInputElement>(null), hist = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  /* what is said elsewhere (a choice clicked in the log) shows here too */
  useEffect(() => { talkLog.onSaid = () => setSaid(talkLog.said); return () => { talkLog.onSaid = null; }; }, []);
  /* a ticket that waited before the page was open: its question (or its failed run) is put in the log first */
  useEffect(() => { if (ticket) void announceTicket(ticket, onOpenTicket, 'seen-on-open'); }, [ticket, onOpenTicket]);
  /* the log: the toasts and what was said, in the order they came */
  const lines = useMemo(() => [...history.map((t) => ({ at: t.createdAt, t })), ...said.map((s) => ({ at: s.at, s }))].sort((a, b) => a.at - b.at), [history, said]);
  useEffect(() => { if (hist.current) hist.current.scrollTop = hist.current.scrollHeight; }, [lines.length]);

  /* a slash: the commands that apply to whoever the line talks to, those that start with what is typed listed over it */
  const typed = commandName(text), commands = useMemo(() => commandsFor(target), [target]);
  const shown = typed === null ? [] : matching(commands, typed);
  const [pick, setPick] = useState(0);
  useEffect(() => setPick(0), [typed]);
  const acts: CommandActs = {
    retry: (id) => useFactoryStore.getState().retry(id), setAside: (id) => useFactoryStore.getState().setAside(id),
    release: (id) => useFactoryStore.getState().release(id), star: (id, on) => useFactoryStore.getState().star(id, on),
    giveBack: (id) => useFactoryStore.getState().giveBack(id), open: (id) => onOpenTicket(id),
    newConversation: () => { try { localStorage.removeItem(SESSION_KEY); } catch { /* none */ } },
  };
  const command = (name: string) => {
    const c = commands.find((x) => x.name === name) ?? (shown[pick] && typed !== null ? shown[pick] : null);
    setText('');
    if (!c) { toast.warning(`/${name}: no such command here. Type / to see them`); return; }
    talkLog.said = [...talkLog.said, { at: Date.now(), to: target.kind === 'assistant' ? 'Assistant' : target.label, text: `/${c.name}` }].slice(-50); setSaid(talkLog.said);
    void Promise.resolve(c.run(acts)).then((said) => { if (said) toast.info(said); }, (err: unknown) => toast.error(`/${c.name} failed`, { detail: err instanceof Error ? err.message : String(err) }));
  };

  const send = () => {
    const body = text.trim();
    if (!body) return;
    if (typed !== null) { command(typed); return; }
    setText('');
    if (target.kind === 'ticket') { answer(target, body); return; }
    talkLog.said = [...talkLog.said, { at: Date.now(), to: 'Assistant', text: body }].slice(-50); setSaid(talkLog.said);
    talkLog.last = 'assistant';
    askAssistant(body, (reply, sessionId) => toast.show({
      title: '[Assistant]', message: short(reply), icon: '✦', durationMs: 15_000,
      action: { label: 'Open', onClick: () => { useAssistantStore.getState().openSession(sessionId); navigate('/assistant'); } },
    }));
  };

  return (
    <div className="absolute z-[8] flex flex-col gap-1.5" style={style} role="dialog" aria-label="Talk">
      <div ref={hist} className="flex max-h-[260px] flex-col gap-[3px] overflow-y-auto rounded-lg bg-[color-mix(in_srgb,var(--theme-bg-base)_55%,transparent)] px-2.5 py-2" aria-label="Log">
        {lines.length === 0 && <span className="text-[12px] text-[var(--theme-text-muted)]">Nothing yet: messages and replies show here.</span>}
        {lines.map((l, i) => ('t' in l ? <FloorLine key={`t${(l.t as ToastItem).id}:${(l.t as ToastItem).version}`} toast={l.t as ToastItem} /> : (
          <div key={`s${i}`} className="fleex-floor-line flex items-baseline gap-1.5 text-[12.5px] leading-[1.35] text-[var(--theme-text-primary)]" data-keep="true">
            <span className="flex-none font-mono text-[10.5px] text-[var(--theme-text-muted)]">{new Date(l.s!.at).toTimeString().slice(0, 5)}</span>
            <b className="flex-none font-semibold text-[var(--theme-accent)]">To {l.s!.to}</b><span className="min-w-0">{l.s!.text}</span>
          </div>
        )))}
      </div>
      {typed !== null && (
        <div className="flex flex-col gap-px rounded-md border border-[var(--theme-border-input)] bg-[color-mix(in_srgb,var(--theme-bg-base)_85%,transparent)] p-1 backdrop-blur-sm" role="listbox" aria-label="Commands">
          {shown.length === 0 && <span className="px-2 py-1 text-[12px] text-[var(--theme-text-muted)]">No command starts with /{typed} here</span>}
          {shown.map((c, i) => (
            <button key={c.name} type="button" role="option" aria-selected={i === pick} onMouseDown={(e) => { e.preventDefault(); command(c.name); }}
              className={cn('flex items-baseline gap-2 rounded px-2 py-0.5 text-left text-[12px]', i === pick ? 'bg-[var(--theme-bg-hover)] text-[var(--theme-text-primary)]' : 'text-[var(--theme-text-secondary)]')}>
              <b className="font-mono">/{c.name}</b><span className="truncate">{c.help}</span>
            </button>
          ))}
        </div>
      )}
      <span className="self-end font-mono text-[10px] text-[var(--theme-text-muted)] [text-shadow:0_1px_2px_var(--theme-bg-base)]">
        {targets.length > 1 ? 'Tab · who you talk to · ' : ''}/ · commands · Enter · send · Esc · close
      </span>
      <div className="flex items-center rounded-md border border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-bg-base)_70%,transparent)] pl-2 backdrop-blur-sm">
        <span className={cn('flex-none whitespace-nowrap font-mono text-[12px] font-bold', target.kind === 'assistant' ? 'text-[var(--tint-green-solid)]' : 'text-[var(--tint-blue-solid)]')} data-testid="talk-target">
          [{target.kind === 'assistant' ? 'Assistant' : target.label}]&nbsp;
        </span>
        <input ref={input} id="factory-talk" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" aria-label={`Message to ${target.kind === 'assistant' ? 'the assistant' : target.label}`}
          placeholder={target.kind === 'assistant' ? 'Ask the assistant' : target.phase === 'question' ? 'Answer its question: its station runs again' : target.phase === 'review' ? 'Comment: the decision is on the gate\'s buttons' : 'Comment in its thread'}
          className="min-w-0 flex-1 bg-transparent py-1.5 pr-2 text-[12.5px] text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-muted)]"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'Tab' && shown.length) { e.preventDefault(); setText(`/${shown[pick]!.name}`); }
            else if (e.key === 'Tab') { e.preventDefault(); setAt((n) => n + 1); }
            else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && shown.length) { e.preventDefault(); setPick((n) => (n + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length); }
            else if (e.key === 'Enter') { e.preventDefault(); send(); }
          }} />
      </div>
    </div>
  );
}

/** What the line keeps while the page is open: what was said, who was talked to last, the tickets talked to. */
export const talkLog = {
  said: [] as Said[], last: 'ticket' as 'assistant' | 'ticket', tickets: new Map<string, string>(),
  /** The last ticket that wrote to you: the line opens on it when nothing is selected. */
  lastSpoke: null as TalkTicket | null,
  /** The set-asides already written about (a ticket, and when it was set aside). */
  announced: new Set<string>(),
  onSaid: null as (() => void) | null,
};

/**
 * Watch the tickets of the floor: one that a station sets aside (a question, a failed run) while the page is open
 * writes to you (`announceTicket`). Items have no thread: they say nothing here.
 */
export function useTicketVoices(tickets: readonly { ticketId: string; phase: TicketPhase; since: string; note: string; item?: unknown }[], describe: (ticketId: string) => TalkTicket | null, onOpen: (ticketId: string) => void): void {
  const prev = useRef<Map<string, TicketPhase> | null>(null);
  useEffect(() => {
    const before = prev.current, now = new Map(tickets.map((t) => [t.ticketId, t.phase]));
    prev.current = now;
    if (!before) return;                                   // what waited before the page opened is told when you talk to it
    for (const t of tickets) {
      if (t.item || (t.phase !== 'question' && t.phase !== 'failed') || before.get(t.ticketId) === t.phase) continue;
      const d = describe(t.ticketId);
      if (d) void announceTicket({ ...d, phase: t.phase, note: t.note }, onOpen, t.since);
    }
  }, [tickets, describe, onOpen]);
}

/**
 * The replies of the tickets talked to from the line: an agent's comment on one of them comes back as a toast, over
 * the floor and in the log. Mounted with the Factory page.
 */
export function useTalkReplies(onOpenTicket: (ticketId: string) => void): void {
  const open = useRef(onOpenTicket); open.current = onOpenTicket;
  useEffect(() => appWs.onChannel('tickets', (msg) => {
    if (msg.type !== 'comment:created') return;
    const c = msg.data as TicketComment;
    const label = talkLog.tickets.get(c.ticketId);
    if (!label || c.authorType !== 'agent') return;
    toast.show({ title: `[${label}] ${c.authorName}`, message: short(c.body), icon: '↩', durationMs: 15_000, action: { label: 'Open', onClick: () => open.current(c.ticketId) } });
  }), []);
}

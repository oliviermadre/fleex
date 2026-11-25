import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TicketComment } from '@fleex/shared';
import { FloorLine } from '../components/ui/toast/Toaster';
import { toast, useToastHistory, type ToastItem } from '../lib/toast';
import { cn } from '../lib/cn';
import { postTicketComment } from '../services/api';
import { appWs } from '../services/websocket';
import { useAssistantStore } from '../stores/assistantStore';

/**
 * Enter on the floor: a line to talk over the console, under the last messages (picked on
 * `docs/factory/floor-messages.html`). Who it talks to is written at its start and Tab changes it: the assistant,
 * or a ticket (the one selected, or the first that needs you). To a ticket, it is a comment in its thread, as you; if
 * the ticket waits on a question, that is the answer and its station runs again. Replies come back as toasts, so they
 * fade over the floor like any message and stay in the log.
 */

export interface TalkTicket { ticketId: string; label: string }
export type TalkTarget = { kind: 'assistant' } | ({ kind: 'ticket' } & TalkTicket);
/** What was said from the line, kept in the log with the toasts. */
interface Said { at: number; to: string; text: string }

const SESSION_KEY = 'fleex.factory.assistantSession';
const readSession = (): string | null => { try { return localStorage.getItem(SESSION_KEY); } catch { return null; } };
const writeSession = (id: string) => { try { localStorage.setItem(SESSION_KEY, id); } catch { /* none */ } };
/** Said once, at the start of the Factory's conversation: the answer is read in a one-line log. */
const FLOOR_PREAMBLE = 'I am on the Factory floor of Fleex. Answer in two or three sentences: I read you in a one-line log over the floor.\n\n';
const short = (s: string, n = 280) => (s.length > n ? `${s.slice(0, n - 1)}…` : s).replace(/\s+/g, ' ').trim();

/** The targets Tab goes through, the one the line opens on first: the ticket given (selected), else the last talked to. */
export function talkTargets(ticket: TalkTicket | null, last: 'assistant' | 'ticket'): TalkTarget[] {
  const a: TalkTarget = { kind: 'assistant' };
  if (!ticket) return [a];
  const t: TalkTarget = { kind: 'ticket', ...ticket };
  return last === 'assistant' ? [a, t] : [t, a];
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

export function FactoryTalk({ ticket, onClose, onOpenTicket, style }: {
  /** The ticket a message can go to: the one selected, else the first that needs you; null when there is none. */
  ticket: TalkTicket | null;
  onClose: () => void; onOpenTicket: (ticketId: string) => void;
  style?: React.CSSProperties;
}) {
  const navigate = useNavigate();
  const history = useToastHistory();
  const [said, setSaid] = useState<Said[]>(() => talkLog.said);
  const [text, setText] = useState('');
  const targets = useMemo(() => talkTargets(ticket, talkLog.last), [ticket]);
  const [at, setAt] = useState(0);
  const target = targets[at % targets.length]!;
  const input = useRef<HTMLInputElement>(null), hist = useRef<HTMLDivElement>(null);
  useEffect(() => { input.current?.focus(); }, []);
  /* the log: the toasts and what was said, in the order they came */
  const lines = useMemo(() => [...history.map((t) => ({ at: t.createdAt, t })), ...said.map((s) => ({ at: s.at, s }))].sort((a, b) => a.at - b.at), [history, said]);
  useEffect(() => { if (hist.current) hist.current.scrollTop = hist.current.scrollHeight; }, [lines.length]);

  const send = () => {
    const body = text.trim();
    if (!body) return;
    const entry: Said = { at: Date.now(), to: target.kind === 'assistant' ? 'Assistant' : target.label, text: body };
    talkLog.said = [...talkLog.said, entry].slice(-50); setSaid(talkLog.said); setText('');
    talkLog.last = target.kind;
    if (target.kind === 'ticket') {
      talkLog.tickets.set(target.ticketId, target.label);
      void postTicketComment(target.ticketId, body).catch((err: unknown) =>
        toast.error(`Not sent to ${target.label}`, { detail: err instanceof Error ? err.message : String(err), action: { label: 'Open', onClick: () => onOpenTicket(target.ticketId) } }));
    } else {
      askAssistant(body, (answer, sessionId) => toast.show({
        title: '[Assistant]', message: short(answer), icon: '✦', durationMs: 15_000,
        action: { label: 'Open', onClick: () => { useAssistantStore.getState().openSession(sessionId); navigate('/assistant'); } },
      }));
    }
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
      <span className="self-end font-mono text-[10px] text-[var(--theme-text-muted)] [text-shadow:0_1px_2px_var(--theme-bg-base)]">
        {targets.length > 1 ? 'Tab · who you talk to · ' : ''}Enter · send · Esc · close
      </span>
      <div className="flex items-center rounded-md border border-[var(--theme-accent)] bg-[color-mix(in_srgb,var(--theme-bg-base)_70%,transparent)] pl-2 backdrop-blur-sm">
        <span className={cn('flex-none whitespace-nowrap font-mono text-[12px] font-bold', target.kind === 'assistant' ? 'text-[var(--tint-green-solid)]' : 'text-[var(--tint-blue-solid)]')} data-testid="talk-target">
          [{target.kind === 'assistant' ? 'Assistant' : target.label}]&nbsp;
        </span>
        <input ref={input} id="factory-talk" value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" aria-label={`Message to ${target.kind === 'assistant' ? 'the assistant' : target.label}`}
          placeholder={target.kind === 'assistant' ? 'Ask the assistant' : 'Comment, or answer its question'}
          className="min-w-0 flex-1 bg-transparent py-1.5 pr-2 text-[12.5px] text-[var(--theme-text-primary)] outline-none placeholder:text-[var(--theme-text-muted)]"
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
            else if (e.key === 'Tab') { e.preventDefault(); setAt((n) => n + 1); }
            else if (e.key === 'Enter') { e.preventDefault(); send(); }
          }} />
      </div>
    </div>
  );
}

/** What the line keeps while the page is open: what was said, who was talked to last, the tickets talked to. */
export const talkLog = { said: [] as Said[], last: 'ticket' as 'assistant' | 'ticket', tickets: new Map<string, string>() };

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

import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { AgentExecution, TicketComment } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { PriorityIndicator } from '../components/tickets/PriorityIndicator';
import { ComplexityBadge } from '../components/tickets/ComplexityBadge';
import { Composer } from '../components/work/task/Composer';
import { RunCard } from '../components/work/task/RunCard';
import { buildStream } from '../components/work/selectors';
import { useTicketDeliverables } from '../components/work/panel/useTicketDeliverables';
import { useUIStore } from '../stores/uiStore';
import * as api from '../services/api';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';
import { complexityOf, priorityOf, TicketToken } from './FactoryTicketMeta';
import { NEED_LABEL, needKind } from './needs';
import { useTicketRuns } from './useTicketRuns';
import { FactoryPeekRun, RunDot } from './FactoryPeekRun';
import type { StationExec } from './types';

const REFRESH_MS = 3000;
const noop = () => {};
/** The stations whose run starts an agent execution, so a log to show once its id is known. */
const LOGGED: readonly StationExec[] = ['agent', 'skill', 'panel'];

function Bubble({ c }: { c: TicketComment }) {
  return (
    <div className={cn('max-w-[92%] rounded-lg px-2.5 py-1.5 text-[12.5px]', c.authorType === 'user' ? 'self-end bg-[var(--theme-accent-muted)]' : 'self-start border border-[var(--theme-border)]')}>
      {c.authorType !== 'user' && <div className="mb-0.5 text-[10.5px] text-[var(--theme-text-muted)]">{c.authorName}</div>}
      <div className="text-[var(--theme-text-primary)]"><MarkdownRenderer content={c.body} onToggleCheckbox={noop} /></div>
    </div>
  );
}

/** Put a card beside what it is about (`r`, in the floor's pixels): to its right, else its left, clear of the list of what needs someone. */
export function placeBeside(node: HTMLElement | null, r: { x: number; y: number; w: number; h: number }, at: { current: string }): void {
  const host = node?.parentElement;
  if (!node || !host) return;
  const w = node.offsetWidth, h = node.offsetHeight, clear = 290;      // the list of what needs someone, on the left
  const left = r.x + r.w + 12 + w <= host.clientWidth - 8 ? r.x + r.w + 12 : r.x - 12 - w >= clear ? r.x - 12 - w : Math.max(clear, host.clientWidth - w - 8);
  const top = Math.max(8, Math.min(r.y, host.clientHeight - h - 8));
  const next = `translate(${Math.round(Math.max(8, left))}px, ${Math.round(top)}px)`;
  if (next !== at.current) { at.current = next; node.style.transform = next; node.style.visibility = 'visible'; }
}

export interface PeekHandle {
  /** Where the ticket's machine (or the ticket itself) is on the floor, in the floor's own pixels: the card sits beside it. */
  place(r: { x: number; y: number; w: number; h: number }): void;
}

/**
 * A ticket's thread, beside its machine, at the first click: enough to read what an agent asks or what a gate has
 * to decide on, without opening the ticket. The whole conversation scrolls; what was last delivered is listed on top.
 * What the ticket waits for is done from here: a decision with its optional reason, an answer, another run.
 *
 * Once a station has run the ticket, a Thread · Run switch shows that run's log in the card too. A ticket a station
 * is running opens on its live log: on a running ticket, that is what one clicks to see. Anything else opens on the
 * thread, the log one click away. The tab is not remembered: each opening applies the rule again.
 *
 * The thread carries the ticket's runs among its messages, as the Work stream does: a run card sits where the run
 * started. A click on one shows its log in the Run tab; a run no station started (no Run tab for it) pops out.
 */
export const FactoryPeek = forwardRef<PeekHandle, { ticketId: string; onOpen: () => void; onClose: () => void; onPopOut?: (executionId: string, title: string) => void }>(function FactoryPeek({ ticketId, onOpen, onClose, onPopOut }, ref) {
  const store = useFactoryStore();
  const ft = store.snapshot?.tickets.find((t) => t.ticketId === ticketId) ?? null;
  const machine = ft && store.layout ? store.layout.machines.find((m) => m.id === ft.machineId) ?? null : null;
  const logged = machine?.kind === 'station' && !!machine.exec && LOGGED.includes(machine.exec);
  const runs = useTicketRuns(ft, store.snapshot?.serverTime);
  const [tab, setTab] = useState<'thread' | 'run'>(() => (ft?.phase === 'running' && logged ? 'run' : 'thread'));
  /* the run on screen: set once one is shown, then changed only by a click (the picker, or following the ticket) */
  const [picked, setPicked] = useState<{ id: string; base: string | null } | null>(null);
  const pick = picked?.id ?? null;
  const [comments, setComments] = useState<TicketComment[] | null>(null);
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { deliverables } = useTicketDeliverables(ticketId);
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  const el = useRef<HTMLDivElement>(null), thread = useRef<HTMLDivElement>(null), seen = useRef(-1), at = useRef('');

  useImperativeHandle(ref, () => ({ place: (r) => placeBeside(el.current, r, at) }), []);

  const load = useCallback(async () => {
    /* the runs come with the messages, so a run card's state follows the run; without them the thread still shows */
    const [c, e] = await Promise.allSettled([api.fetchTicketComments(ticketId), api.fetchExecutionsForTicket(ticketId)]);
    if (c.status === 'fulfilled') setComments(c.value);   // else the API helper already raised a toast
    if (e.status === 'fulfilled') setExecutions(e.value);
  }, [ticketId]);
  const stream = useMemo(() => (comments ? buildStream(comments, [], executions) : null), [comments, executions]);
  useEffect(() => { setComments(null); setExecutions([]); setDraft(''); setReason(''); seen.current = -1; void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS); return () => window.clearInterval(id); }, [load]);
  /* it opens on the end of the thread and follows what is added; scrolled up, it stays where it was put */
  useEffect(() => { const n = thread.current; if (n && stream && stream.length !== seen.current) { seen.current = stream.length; n.scrollTop = n.scrollHeight; } }, [stream]);

  const current = runs.current;
  const pending = ft?.phase === 'running' && logged && !!ft.runId && !(current?.id === ft.runId && current.executionId);
  const switchable = runs.list.length > 0 || pending;
  const view = switchable ? tab : 'thread';
  const candidates = current && !runs.list.includes(current) ? [...runs.list, current] : runs.list;
  const shown = (pick ? candidates.find((r) => r.id === pick) : null) ?? (pick ? null : current);
  /* `base` is the ticket's run when the pick was made: the ticket moved on only if that changed since, not when an older run is picked */
  const setPick = (id: string) => setPicked({ id, base: current?.id ?? null });
  const next = pick && current && current.id !== pick && current.id !== picked?.base && current.status === 'running' ? current : null;
  useEffect(() => { if (view === 'run' && !pick && current?.executionId) setPicked({ id: current.id, base: current.id }); }, [view, pick, current]);
  /* a run card in the thread: a station's run opens on the Run tab, any other one in the floating panel */
  const openRun = (executionId: string, title: string) => {
    const r = runs.list.find((x) => x.executionId === executionId);
    if (r) { setPick(r.id); setTab('run'); } else if (onPopOut) { onPopOut(executionId, title); onClose(); }
  };

  if (!ft) return null;
  const info = ft.info, need = needKind(ft), gate = ft.phase === 'review' && machine?.kind === 'station' ? machine : null;
  const where = `${machine ? machine.name || machine.kind : 'On the floor'}${need ? ` · ${NEED_LABEL[need]}` : ''}`;
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); await load(); } catch { /* toast already shown */ } finally { setBusy(false); } };
  /* the composer clears the draft once this resolves, and keeps it when it throws */
  const say = async (body: string) => { setBusy(true); try { await api.postTicketComment(ticketId, body); await load(); } finally { setBusy(false); } };
  /* Escape in a field: with something typed it only leaves the field, empty it closes the card, as it does on the floor.
     It bubbles up from the composer's textarea; the mention menu, when open, has already taken it (defaultPrevented). */
  const escape = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const field = e.target;
    if (e.key !== 'Escape' || e.defaultPrevented || !(field instanceof HTMLTextAreaElement)) return;
    e.preventDefault(); if (field.value) field.blur(); else onClose();
  };
  const latest = [...deliverables].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);

  return (
    <div ref={el} role="dialog" aria-label={`Ticket ${info?.displayId ?? ''}`} style={{ visibility: 'hidden' }}
      className={cn('absolute left-0 top-0 z-[6] flex w-[380px] max-w-[calc(100%-16px)] flex-col rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] shadow-2xl',
        view === 'run' ? 'h-[min(560px,calc(100%-16px))]' : 'max-h-[min(480px,calc(100%-16px))]')}>
      <div className="flex flex-none items-center gap-2.5 border-b border-[var(--theme-border)] px-2.5 py-2">
        <TicketToken info={info ? { ...info, favorite: false } : null} size={26} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] text-[var(--theme-text-primary)]">{info?.title ?? ticketId}</b>
          {switchable ? (
            <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--theme-text-muted)]">
              <span className="min-w-0 truncate"><span className="font-mono">#{info?.displayId ?? '?'}</span> · {where}</span>
              <PriorityIndicator priority={priorityOf(info)} /><ComplexityBadge complexity={complexityOf(info)} />
            </span>
          ) : <span className="block truncate text-[11px] text-[var(--theme-text-muted)]"><span className="font-mono">#{info?.displayId ?? '?'}</span> · {where}</span>}
        </div>
        {switchable ? (
          <div role="tablist" aria-label="Thread or run" className="flex flex-none gap-0.5 rounded-md bg-[var(--theme-bg-overlay)] p-0.5">
            {(['thread', 'run'] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setTab(k)}
                className={cn('flex items-center gap-1.5 rounded px-2 py-0.5 text-[11.5px] font-semibold', view === k ? 'bg-[var(--theme-bg-surface)] text-[var(--theme-text-primary)] shadow-sm' : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]')}>
                {k === 'thread' ? <>Thread{comments && comments.length > 0 && <span className="font-normal text-[var(--theme-text-faint)]">{comments.length}</span>}</> : <><RunDot run={current} starting={pending} />Run</>}
              </button>
            ))}
          </div>
        ) : <><PriorityIndicator priority={priorityOf(info)} /><ComplexityBadge complexity={complexityOf(info)} /></>}
      </div>
      {view === 'run' && <FactoryPeekRun runs={runs} shown={shown} next={next} onPick={setPick} onOpen={onOpen} onPopOut={onPopOut && ((id, title) => { onPopOut(id, title); onClose(); })} />}
      {/* the thread stays mounted behind the Run tab: its scroll, its comments and a draft survive a look at the log */}
      <div className={view === 'run' ? 'hidden' : 'contents'}>
      {latest.length > 0 && (
        <div className="flex flex-none gap-1.5 overflow-x-auto border-b border-[var(--theme-border)] px-2.5 py-1.5 [scrollbar-width:none]" aria-label="Latest deliverables">
          {latest.map((d) => (
            <button key={d.id} type="button" onClick={() => openDeliverable(d)} title={d.title}
              className="flex h-6 max-w-[190px] flex-none items-center gap-1.5 rounded-md border border-l-2 border-[var(--theme-border)] border-l-[var(--theme-accent)] px-2 text-[11px] hover:bg-[var(--theme-bg-overlay)]">
              <span className="text-[var(--theme-text-muted)]">{d.type}</span><span className="truncate text-[var(--theme-text-primary)]">{d.title}</span>
            </button>
          ))}
        </div>
      )}
      <div ref={thread} className="flex min-h-[72px] flex-1 flex-col gap-2 overflow-y-auto p-2.5">
        {stream === null ? <div className="flex justify-center py-4"><Spinner /></div>
          : stream.length === 0 ? <div className="py-4 text-center text-xs text-[var(--theme-text-muted)]">No message on this ticket yet.</div>
          : stream.map((entry) => entry.kind === 'run' ? <RunCard key={`r-${entry.execution.id}`} execution={entry.execution} onOpen={openRun} />
            : entry.kind === 'comment' ? <Bubble key={entry.comment.id} c={entry.comment} /> : null)}
      </div>
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-t border-[var(--theme-border)] p-2">
        {gate ? (
          <>
            <span className="basis-full text-[11px] font-semibold text-[var(--theme-warning)]">{gate.name || 'The gate'} waits for your decision</span>
            <div className="basis-full" onKeyDown={escape}>
              <Composer bare ticketId={ticketId} value={reason} onChange={setReason} onSend={noop} submitOn="none" showExecBar={false} showSend={false}
                placeholder="Reason (optional), kept in the thread: markdown, paste a screenshot" />
            </div>
            {gate.outcomes.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={busy} onClick={() => run(() => store.resolve(ticketId, o, reason))}>{o}</Button>)}
          </>
        ) : (
          <>
            <div className="basis-full" onKeyDown={escape}>
              <Composer bare ticketId={ticketId} value={draft} onChange={setDraft} onSend={say} posting={busy} showExecBar={false}
                placeholder={ft.phase === 'question' && machine?.kind === 'station' ? 'Answer: the station takes the ticket again' : 'Reply: markdown, @ to mention, paste a screenshot'} />
            </div>
            {ft.phase === 'failed' && <Button size="sm" disabled={busy} onClick={() => run(() => store.putBack(ticketId))}>Run again</Button>}
          </>
        )}
        <Button size="sm" variant={gate ? 'ghost' : 'primary'} className="ml-auto" onClick={onOpen} title="The whole ticket (also a double-click; Enter on the floor talks to it)">Open</Button>
      </div>
      </div>
    </div>
  );
});

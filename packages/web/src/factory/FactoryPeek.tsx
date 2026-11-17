import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { TicketComment } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Spinner } from '../components/ui/Spinner';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { PriorityIndicator } from '../components/tickets/PriorityIndicator';
import { ComplexityBadge } from '../components/tickets/ComplexityBadge';
import { useTicketDeliverables } from '../components/work/panel/useTicketDeliverables';
import { useUIStore } from '../stores/uiStore';
import * as api from '../services/api';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';
import { complexityOf, priorityOf, TicketToken } from './FactoryTicketMeta';
import { NEED_LABEL, needKind } from './needs';

const REFRESH_MS = 3000;
const noop = () => {};
const FIELD = 'h-7 min-w-0 rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2 text-xs text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]';

export interface PeekHandle {
  /** Where the ticket's machine (or the ticket itself) is on the floor, in the floor's own pixels: the card sits beside it. */
  place(r: { x: number; y: number; w: number; h: number }): void;
}

/**
 * A ticket's thread, beside its machine, at the first click: enough to read what an agent asks or what a gate has
 * to decide on, without opening the ticket. The whole conversation scrolls; what was last delivered is listed on top.
 * What the ticket waits for is done from here: a decision with its optional reason, an answer, another run.
 */
export const FactoryPeek = forwardRef<PeekHandle, { ticketId: string; onOpen: () => void; onClose: () => void }>(function FactoryPeek({ ticketId, onOpen, onClose }, ref) {
  const store = useFactoryStore();
  const ft = store.snapshot?.tickets.find((t) => t.ticketId === ticketId) ?? null;
  const machine = ft && store.layout ? store.layout.machines.find((m) => m.id === ft.machineId) ?? null : null;
  const [comments, setComments] = useState<TicketComment[] | null>(null);
  const [draft, setDraft] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const { deliverables } = useTicketDeliverables(ticketId);
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  const el = useRef<HTMLDivElement>(null), thread = useRef<HTMLDivElement>(null), seen = useRef(-1), at = useRef('');

  useImperativeHandle(ref, () => ({
    place: (r) => {
      const node = el.current, host = node?.parentElement;
      if (!node || !host) return;
      const w = node.offsetWidth, h = node.offsetHeight, clear = 290;      // the list of what needs someone, on the left
      const left = r.x + r.w + 12 + w <= host.clientWidth - 8 ? r.x + r.w + 12 : r.x - 12 - w >= clear ? r.x - 12 - w : Math.max(clear, host.clientWidth - w - 8);
      const top = Math.max(8, Math.min(r.y, host.clientHeight - h - 8));
      const next = `translate(${Math.round(Math.max(8, left))}px, ${Math.round(top)}px)`;
      if (next !== at.current) { at.current = next; node.style.transform = next; node.style.visibility = 'visible'; }
    },
  }), []);

  const load = useCallback(async () => { try { setComments(await api.fetchTicketComments(ticketId)); } catch { /* the API helper already raised a toast */ } }, [ticketId]);
  useEffect(() => { setComments(null); setDraft(''); setReason(''); seen.current = -1; void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS); return () => window.clearInterval(id); }, [load]);
  /* it opens on the end of the thread and follows what is added; scrolled up, it stays where it was put */
  useEffect(() => { const n = thread.current; if (n && comments && comments.length !== seen.current) { seen.current = comments.length; n.scrollTop = n.scrollHeight; } }, [comments]);

  if (!ft) return null;
  const info = ft.info, need = needKind(ft), gate = ft.phase === 'review' && machine?.kind === 'station' ? machine : null;
  const where = `${machine ? machine.name || machine.kind : 'On the floor'}${need ? ` · ${NEED_LABEL[need]}` : ''}`;
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); await load(); } catch { /* toast already shown */ } finally { setBusy(false); } };
  const say = () => run(async () => { if (draft.trim()) { await api.postTicketComment(ticketId, draft.trim()); setDraft(''); } });
  /* Escape in a field: with something typed it only leaves the field, empty it closes the card, as it does on the floor */
  const escape = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key !== 'Escape') return; e.preventDefault(); if (e.currentTarget.value) e.currentTarget.blur(); else onClose(); };
  const latest = [...deliverables].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);

  return (
    <div ref={el} role="dialog" aria-label={`Ticket ${info?.displayId ?? ''}`} style={{ visibility: 'hidden' }}
      className="absolute left-0 top-0 z-[6] flex max-h-[min(480px,calc(100%-16px))] w-[380px] max-w-[calc(100%-16px)] flex-col rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] shadow-2xl">
      <div className="flex flex-none items-center gap-2.5 border-b border-[var(--theme-border)] px-2.5 py-2">
        <TicketToken info={info ? { ...info, favorite: false } : null} size={26} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] text-[var(--theme-text-primary)]">{info?.title ?? ticketId}</b>
          <span className="block truncate text-[11px] text-[var(--theme-text-muted)]"><span className="font-mono">#{info?.displayId ?? '?'}</span> · {where}</span>
        </div>
        <PriorityIndicator priority={priorityOf(info)} /><ComplexityBadge complexity={complexityOf(info)} />
      </div>
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
        {comments === null ? <div className="flex justify-center py-4"><Spinner /></div>
          : comments.length === 0 ? <div className="py-4 text-center text-xs text-[var(--theme-text-muted)]">No message on this ticket yet.</div>
          : comments.map((c) => (
            <div key={c.id} className={cn('max-w-[92%] rounded-lg px-2.5 py-1.5 text-[12.5px]', c.authorType === 'user' ? 'self-end bg-[var(--theme-accent-muted)]' : 'self-start border border-[var(--theme-border)]')}>
              {c.authorType !== 'user' && <div className="mb-0.5 text-[10.5px] text-[var(--theme-text-muted)]">{c.authorName}</div>}
              <div className="text-[var(--theme-text-primary)]"><MarkdownRenderer content={c.body} onToggleCheckbox={noop} /></div>
            </div>
          ))}
      </div>
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-t border-[var(--theme-border)] p-2">
        {gate ? (
          <>
            <span className="basis-full text-[11px] font-semibold text-[var(--theme-warning)]">{gate.name || 'The gate'} waits for your decision</span>
            <input id="factory-peek-reason" aria-label="Reason" placeholder="Reason (optional), kept in the thread" value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={escape} className={cn(FIELD, 'basis-full')} />
            {gate.outcomes.map((o, i) => <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={busy} onClick={() => run(() => store.resolve(ticketId, o, reason))}>{o}</Button>)}
          </>
        ) : (
          <>
            <input id="factory-peek-reply" aria-label="Reply" placeholder={ft.phase === 'question' ? 'Answer: the station takes it again' : 'Reply'} value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { escape(e); if (e.key === 'Enter' && draft.trim() && !busy) { e.preventDefault(); void (ft.phase === 'question' ? run(async () => { await api.postTicketComment(ticketId, draft.trim()); setDraft(''); await store.putBack(ticketId); }) : say()); } }}
              className={cn(FIELD, 'flex-1')} />
            {ft.phase === 'failed' && <Button size="sm" disabled={busy} onClick={() => run(() => store.putBack(ticketId))}>Run again</Button>}
          </>
        )}
        <Button size="sm" variant={gate ? 'ghost' : 'primary'} className="ml-auto" onClick={onOpen} title="The whole ticket (also Enter, V, or a double-click)">Open</Button>
      </div>
    </div>
  );
});

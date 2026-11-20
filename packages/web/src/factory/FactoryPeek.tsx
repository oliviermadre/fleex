import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { TicketComment } from '@fleex/shared';
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
import { FactoryPeekReply } from './FactoryPeekReply';

const REFRESH_MS = 3000;
const noop = () => {};

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
  const { deliverables } = useTicketDeliverables(ticketId);
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  const el = useRef<HTMLDivElement>(null), thread = useRef<HTMLDivElement>(null), seen = useRef(-1), at = useRef(''), atEnd = useRef(true);

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
  useEffect(() => { setComments(null); seen.current = -1; void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS); return () => window.clearInterval(id); }, [load]);
  /* it opens on the end of the thread and follows what is added; scrolled up, it stays where it was put */
  useEffect(() => { const n = thread.current; if (n && comments && comments.length !== seen.current) { seen.current = comments.length; n.scrollTop = n.scrollHeight; } }, [comments]);

  /* read to its end, the thread keeps showing its end when the reply area takes its room (⤢, a long reason) */
  const shown = !!ft;
  useEffect(() => {
    const n = thread.current;
    if (!n || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (atEnd.current) n.scrollTop = n.scrollHeight; });
    ro.observe(n);
    return () => ro.disconnect();
  }, [shown]);

  if (!ft) return null;
  const info = ft.info, need = needKind(ft), gate = ft.phase === 'review' && machine?.kind === 'station' ? machine : null;
  const where = `${machine ? machine.name || machine.kind : 'On the floor'}${need ? ` · ${NEED_LABEL[need]}` : ''}`;
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
      {/* the thread gives way first, down to 72px, so the reply area and its button bar keep their room (shrink-[100]) */}
      <div ref={thread} onScroll={(e) => { const n = e.currentTarget; atEnd.current = n.scrollHeight - n.scrollTop - n.clientHeight < 8; }} className="flex min-h-[72px] flex-1 shrink-[100] flex-col gap-2 overflow-y-auto p-2.5">
        {comments === null ? <div className="flex justify-center py-4"><Spinner /></div>
          : comments.length === 0 ? <div className="py-4 text-center text-xs text-[var(--theme-text-muted)]">No message on this ticket yet.</div>
          : comments.map((c) => (
            <div key={c.id} className={cn('max-w-[92%] rounded-lg px-2.5 py-1.5 text-[12.5px]', c.authorType === 'user' ? 'self-end bg-[var(--theme-accent-muted)]' : 'self-start border border-[var(--theme-border)]')}>
              {c.authorType !== 'user' && <div className="mb-0.5 text-[10.5px] text-[var(--theme-text-muted)]">{c.authorName}</div>}
              <div className="text-[var(--theme-text-primary)]"><MarkdownRenderer content={c.body} onToggleCheckbox={noop} /></div>
            </div>
          ))}
      </div>
      <FactoryPeekReply key={ticketId} ticketId={ticketId} gate={gate} asked={ft.phase === 'question' && machine?.kind === 'station'} failed={ft.phase === 'failed'}
        reload={load} onOpen={onOpen} onClose={onClose} />
    </div>
  );
});

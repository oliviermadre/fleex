import { useCallback, useEffect, useRef, useState } from 'react';
import type { Ticket, TicketComment } from '@fleex/shared';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { Spinner } from '../components/ui/Spinner';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { openTicketInWork } from '../components/work/openInWork';
import * as api from '../services/api';
import { tint } from '../lib/tints';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import { byRunAt, humanCall, runAt, type FactoryRun } from './types';

const REFRESH_MS = 3000;
const noop = () => {};
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); };

/**
 * A ticket, without leaving the floor: what it is, where it stands, its thread,
 * and what it waits for. A gate is decided here, a question is answered here.
 */
export function FactoryTicketModal({ ticketId, onClose }: { ticketId: string; onClose: () => void }) {
  const store = useFactoryStore();
  const ft = store.snapshot?.tickets.find((t) => t.ticketId === ticketId) ?? null;
  const machine = ft && store.layout ? store.layout.machines.find((m) => m.id === ft.machineId) ?? null : null;
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [comments, setComments] = useState<TicketComment[] | null>(null);
  const [runs, setRuns] = useState<FactoryRun[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const threadEnd = useRef<HTMLDivElement>(null);
  const seen = useRef(0);

  const load = useCallback(async () => {
    try {
      const [t, c, r] = await Promise.all([api.fetchTicket(ticketId), api.fetchTicketComments(ticketId), factoryApi.runs(ticketId).catch(() => [])]);
      setTicket(t); setComments(c); setRuns([...r].sort(byRunAt));
    } catch { /* the API helper already raised a toast */ }
  }, [ticketId]);
  useEffect(() => { void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS); return () => window.clearInterval(id); }, [load]);
  useEffect(() => { if (comments && comments.length !== seen.current) { seen.current = comments.length; threadEnd.current?.scrollIntoView({ block: 'end' }); } }, [comments]);

  const call = ft ? humanCall(ft) : null;
  /** Post what was typed, if anything, then do the thing. */
  const act = async (after?: () => Promise<void>) => {
    setBusy(true);
    try {
      if (draft.trim()) { await api.postTicketComment(ticketId, draft.trim()); setDraft(''); }
      if (after) await after();
      await load();
    } catch { /* toast already shown */ } finally { setBusy(false); }
  };
  const where = ft ? `${machine ? machine.name || machine.kind : 'on the floor'}${ft.outcome ? ` · outcome “${ft.outcome}”` : ''}` : 'Not on the factory floor';

  return (
    <Modal open onClose={onClose} maxWidth="max-w-5xl">
      <div className="flex h-[82vh] flex-col">
        <div className="flex flex-none items-start gap-3 border-b border-[var(--theme-border)] p-4">
          <div className="min-w-0 flex-1">
            <div className="font-mono text-xs text-[var(--theme-text-muted)]">#{ticket?.displayId ?? ft?.info?.displayId ?? '…'} · {ticket?.status ?? ft?.info?.status ?? ''} · {ticket?.type ?? 'no type'} · {ticket?.priority ?? ''}</div>
            <div className="text-base font-semibold text-[var(--theme-text-primary)]">{ticket?.title ?? ft?.info?.title ?? 'Loading…'}</div>
            <div className="mt-0.5 text-xs text-[var(--theme-text-secondary)]">{where}</div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => { onClose(); openTicketInWork(ticketId); }} title="Leave the floor and open this ticket in Work">Open in Work</Button>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>

        {ft && call && (
          <div className={cn('flex flex-none flex-wrap items-center gap-2 px-4 py-2 text-xs', tint(call === 'failed' ? 'red' : 'yellow'))} role="status">
            <span className="min-w-0 flex-1">
              <b>{call === 'decision' ? `${machine?.name || 'A gate'} waits for your decision.` : call === 'question' ? 'The agent asked a question.' : 'The run failed.'}</b>{' '}
              {call === 'decision' ? 'Add a note below if you want it on the ticket, then decide.' : call === 'question' ? (ft.phase === 'question' ? 'Answer below: the station runs again with your answer.' : 'Answer below, then drag the ticket back onto a station.') : ft.note}
            </span>
            {call === 'decision' && machine?.kind === 'station' && machine.outcomes.map((o, i) => (
              <Button key={o} size="sm" variant={i === 0 ? 'primary' : 'secondary'} disabled={busy} onClick={() => act(() => store.resolve(ticketId, o))}>{o}</Button>
            ))}
            {call === 'failed' && <Button size="sm" variant="primary" disabled={busy} onClick={() => act(() => store.retry(ticketId))}>Run again</Button>}
          </div>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.6fr)_minmax(260px,1fr)]">
          <div className="flex min-h-0 flex-col border-r border-[var(--theme-border)]">
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {comments === null ? <div className="flex justify-center py-8"><Spinner /></div>
                : comments.length === 0 ? <div className="py-8 text-center text-xs text-[var(--theme-text-muted)]">No message on this ticket yet.</div>
                : (
                  <div className="flex flex-col gap-3">
                    {comments.map((c) => (
                      <div key={c.id} className={cn('max-w-[92%] rounded-lg border px-3 py-2', c.authorType === 'user' ? 'self-end border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]' : 'self-start border-[var(--theme-border)] bg-[var(--theme-bg-surface)]')}>
                        <div className="mb-1 flex items-baseline gap-2 text-[11px] text-[var(--theme-text-muted)]"><b className="text-[var(--theme-text-primary)]">{c.authorName}</b><span className="ml-auto font-mono">{when(c.createdAt)}</span></div>
                        <div className="text-sm text-[var(--theme-text-primary)]"><MarkdownRenderer content={c.body} onToggleCheckbox={noop} /></div>
                      </div>
                    ))}
                    <div ref={threadEnd} />
                  </div>
                )}
            </div>
            <div className="flex flex-none flex-col gap-2 border-t border-[var(--theme-border)] p-3">
              <textarea
                value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} aria-label="Write a message on this ticket"
                placeholder={call === 'question' ? 'Your answer to the agent…' : call === 'decision' ? 'A note with your decision (optional)…' : 'Write a message on this ticket…'}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && draft.trim()) void act(); }}
                className="w-full resize-none rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] px-2.5 py-2 text-sm text-[var(--theme-text-primary)] outline-none focus:border-[var(--theme-accent)]" />
              <div className="flex items-center justify-end gap-2">
                <span className="mr-auto text-[11px] text-[var(--theme-text-muted)]">Posted on the ticket, as in Work. An @agent mention here starts that agent the usual way.</span>
                <Button size="sm" disabled={busy || !draft.trim()} onClick={() => act()}>Send</Button>
                {ft?.phase === 'question' && <Button size="sm" variant="primary" disabled={busy || !draft.trim()} onClick={() => act(() => store.retry(ticketId))}>Answer and run again</Button>}
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4">
            {ft && (
              <div className="flex flex-wrap gap-1.5">
                {ft.phase === 'zone' && !ft.released && <Button size="sm" variant="primary" onClick={() => store.release(ticketId)}>Release</Button>}
                <Button size="sm" variant="ghost" onClick={() => { void store.giveBack(ticketId); onClose(); }}>Give back to Fleex</Button>
              </div>
            )}
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Description</h3>
              {ticket?.description ? <div className="text-sm text-[var(--theme-text-secondary)]"><MarkdownRenderer content={ticket.description} onToggleCheckbox={noop} /></div> : <p className="text-xs text-[var(--theme-text-muted)]">No description.</p>}
            </section>
            <section>
              <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Timeline on the floor</h3>
              {runs.length === 0 && <p className="text-xs text-[var(--theme-text-muted)]">No station has run on this ticket yet.</p>}
              <ol className="flex flex-col">
                {runs.map((r) => (
                  <li key={r.id} className="flex items-baseline gap-2 border-t border-[var(--theme-border)] py-1.5 text-xs first:border-t-0">
                    <span className={cn('h-2 w-2 flex-none rounded-full', r.status === 'failed' || r.status === 'interrupted' ? 'bg-[var(--theme-danger)]' : r.status === 'running' ? 'bg-[var(--theme-success)]' : r.status === 'completed' ? 'bg-[var(--theme-text-muted)]' : 'bg-[var(--theme-warning)]')} />
                    <span className="min-w-0 flex-1 truncate text-[var(--theme-text-primary)]">{r.machineName} <span className="text-[var(--theme-text-muted)]">{r.executor}</span></span>
                    <span className="flex-none font-mono text-[var(--theme-text-secondary)]">{r.outcome ?? r.status}</span>
                    <span className="flex-none font-mono text-[var(--theme-text-muted)]">{when(runAt(r))}</span>
                  </li>
                ))}
              </ol>
            </section>
            {ticket && ticket.tags.length > 0 && (
              <section>
                <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]">Tags</h3>
                <div className="flex flex-wrap gap-1">{ticket.tags.map((tag) => <span key={tag} className="rounded border border-[var(--theme-border-input)] px-1.5 text-[11px] text-[var(--theme-text-secondary)]">{tag}</span>)}</div>
              </section>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { useUIStore } from '../stores/uiStore';
import * as api from '../services/api';
import { cn } from '../lib/cn';
import { useFactoryStore } from './factoryStore';
import { factoryApi } from './factoryApi';
import { TicketToken } from './FactoryTicketMeta';
import { placeBeside, type PeekHandle } from './FactoryPeek';
import { SOURCE_LABEL } from './items';
import { span } from './format';
import { SET_ASIDE, type FactoryRun } from './types';

const noop = () => {};
/** How often the card reads what stations said, while it is open. */
const REFRESH_MS = 4000;
const STATUS_WORD: Record<FactoryRun['status'], string> = { running: 'working on it', completed: 'done', failed: 'failed', needs_review: 'waits for you', question: 'asked a question', interrupted: 'interrupted' };

/**
 * An item at the first click, beside it on the floor, as a ticket's thread is: where it came from, who it is from, how
 * many messages, the few lines it came with, and what is done with it from here. An item has no thread: what the
 * stations it went through answered is listed here instead (its visits, `GET /api/factory/items/:id/runs`), with the
 * deliverable each produced. When a station waits on it (a question, a failed run, a gate), its actions are here too.
 */
export const FactoryItemPeek = forwardRef<PeekHandle, { itemId: string; onClose: () => void }>(function FactoryItemPeek({ itemId, onClose }, ref) {
  const store = useFactoryStore();
  const t = store.snapshot?.tickets.find((x) => x.ticketId === itemId) ?? null;
  const machine = t?.machineId ? store.layout?.machines.find((m) => m.id === t.machineId) ?? null : null;
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  const [runs, setRuns] = useState<FactoryRun[] | null>(null);
  const el = useRef<HTMLDivElement>(null), at = useRef(''), list = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => ({ place: (r) => placeBeside(el.current, r, at) }), []);

  const load = useCallback(async () => { try { setRuns(await factoryApi.itemRuns(itemId)); } catch { /* next time */ } }, [itemId]);
  useEffect(() => { setRuns(null); void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS); return () => window.clearInterval(id); }, [load]);
  /* opens on the latest answer */
  useEffect(() => { const n = list.current; if (n) n.scrollTop = n.scrollHeight; }, [runs?.length]);

  if (!t?.item) return null;
  const item = t.item, source = SOURCE_LABEL[item.source], now = store.snapshot?.serverTime ?? new Date().toISOString();
  const quietFor = Math.max(0, Date.parse(now) - Date.parse(item.lastActivityAt));
  const inIntake = machine?.kind === 'intake';
  const where = machine ? machine.name || (inIntake ? `${source} intake` : machine.kind) : 'On the floor';
  const station = machine?.kind === 'station' ? machine : null;
  const aside = !!station && SET_ASIDE.includes(t.phase), gate = !!station && t.phase === 'review';
  const said = (runs ?? []).filter((r) => r.reply || r.deliverableId || r.status !== 'running');
  const open = async (id: string) => { try { openDeliverable(await api.fetchDeliverable(id)); } catch { /* the API helper raised a toast */ } };

  return (
    <div ref={el} role="dialog" aria-label={`Item from ${source}`} style={{ visibility: 'hidden' }}
      className="absolute left-0 top-0 z-[6] flex max-h-[min(520px,calc(100%-16px))] w-[380px] max-w-[calc(100%-16px)] flex-col rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] shadow-2xl">
      <div className="flex flex-none items-center gap-2.5 border-b border-[var(--theme-border)] px-2.5 py-2">
        <TicketToken info={t.info} size={26} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] text-[var(--theme-text-primary)]">{t.info?.title ?? 'Item'}</b>
          <span className="block truncate text-[11px] text-[var(--theme-text-muted)]">{source}{item.author ? ` · ${item.author}` : ''} · {where}</span>
        </div>
      </div>
      <div ref={list} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5 text-[12.5px]">
        <div className="text-[11px] text-[var(--theme-text-muted)]">
          {item.messages} message{item.messages === 1 ? '' : 's'} · last one {span(quietFor)} ago
          {inIntake && !t.released && ' · waits here while the conversation moves'}
        </div>
        {item.excerpt
          ? <p className="whitespace-pre-wrap break-words text-[var(--theme-text-primary)]">{item.excerpt}</p>
          : <p className="text-[var(--theme-text-muted)]">Nothing more came with it: open it where it lives.</p>}
        {said.length > 0 && <div className="mt-1 border-t border-[var(--theme-border)] pt-2 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">What stations said</div>}
        {said.map((r) => (
          <div key={r.id} className="rounded-lg border border-[var(--theme-border)] px-2.5 py-1.5">
            <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--theme-text-muted)]">
              <b className="text-[var(--theme-text-secondary)]">{r.machineName}</b>
              <span>· {r.outcome ? `left as "${r.outcome}"` : STATUS_WORD[r.status]}</span>
            </div>
            {r.reply && <div className="text-[var(--theme-text-primary)]"><MarkdownRenderer content={r.reply} onToggleCheckbox={noop} /></div>}
            {r.error && !r.reply && <div className="text-[11px] text-[var(--theme-danger)]">{r.error}</div>}
            {r.deliverableId && <button type="button" onClick={() => void open(r.deliverableId!)} className="mt-1 text-[11px] text-[var(--theme-accent)] hover:underline">Open what it delivered</button>}
          </div>
        ))}
        {t.note && <p className={cn('text-[11px]', aside ? 'text-[var(--theme-warning)]' : 'text-[var(--theme-text-muted)]')}>{t.note}</p>}
      </div>
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-t border-[var(--theme-border)] p-2">
        {gate && station.outcomes.map((o, i) => <Button key={o} size="sm" variant={i ? 'secondary' : 'primary'} onClick={() => void store.resolve(itemId, o)}>{o}</Button>)}
        {aside && <Button size="sm" variant="primary" onClick={() => void store.putBack(itemId)} title="The station runs on it again, told what it said before">Run again</Button>}
        {aside && station.outcomes.map((o) => <Button key={o} size="sm" onClick={() => void store.putBack(itemId, o)} title={`Send it on as "${o}"`}>{o}</Button>)}
        {item.url && <Button size="sm" variant={aside || gate ? 'secondary' : 'primary'} onClick={() => window.open(item.url!, '_blank', 'noopener')}>Open in {source}</Button>}
        {t.phase === 'zone' && !t.released && <Button size="sm" onClick={() => void store.release(itemId)} title="Let an arm take it out now, without waiting for the conversation to be quiet">Release</Button>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { void store.archiveItem(itemId); onClose(); }} title="Junk, or done with: it leaves the floor. A new message brings it back">Archive</Button>
      </div>
    </div>
  );
});

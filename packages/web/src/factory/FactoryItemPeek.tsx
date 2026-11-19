import { forwardRef, useImperativeHandle, useRef } from 'react';
import { Button } from '../components/ui/Button';
import { useFactoryStore } from './factoryStore';
import { TicketToken } from './FactoryTicketMeta';
import { placeBeside, type PeekHandle } from './FactoryPeek';
import { SOURCE_LABEL } from './items';
import { span } from './format';

/**
 * An item at the first click, beside it on the floor, as a ticket's thread is: where it came from, who it is from, how
 * many messages, the few lines it came with, and what is done with it from here: open the conversation where it
 * lives, let it out of its intake now, archive it. Its content is not kept by Fleex: the source has it.
 */
export const FactoryItemPeek = forwardRef<PeekHandle, { itemId: string; onClose: () => void }>(function FactoryItemPeek({ itemId, onClose }, ref) {
  const store = useFactoryStore();
  const t = store.snapshot?.tickets.find((x) => x.ticketId === itemId) ?? null;
  const machine = t?.machineId ? store.layout?.machines.find((m) => m.id === t.machineId) ?? null : null;
  const el = useRef<HTMLDivElement>(null), at = useRef('');
  useImperativeHandle(ref, () => ({ place: (r) => placeBeside(el.current, r, at) }), []);
  if (!t?.item) return null;
  const item = t.item, source = SOURCE_LABEL[item.source], now = store.snapshot?.serverTime ?? new Date().toISOString();
  const quietFor = Math.max(0, Date.parse(now) - Date.parse(item.lastActivityAt));
  const inIntake = machine?.kind === 'intake';
  const where = machine ? machine.name || (inIntake ? `${source} intake` : machine.kind) : 'On the floor';
  return (
    <div ref={el} role="dialog" aria-label={`Item from ${source}`} style={{ visibility: 'hidden' }}
      className="absolute left-0 top-0 z-[6] flex max-h-[min(420px,calc(100%-16px))] w-[360px] max-w-[calc(100%-16px)] flex-col rounded-xl border border-[var(--theme-border-input)] bg-[var(--theme-bg-surface)] shadow-2xl">
      <div className="flex flex-none items-center gap-2.5 border-b border-[var(--theme-border)] px-2.5 py-2">
        <TicketToken info={t.info} size={26} />
        <div className="min-w-0 flex-1">
          <b className="block truncate text-[13px] text-[var(--theme-text-primary)]">{t.info?.title ?? 'Item'}</b>
          <span className="block truncate text-[11px] text-[var(--theme-text-muted)]">{source}{item.author ? ` · ${item.author}` : ''} · {where}</span>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2.5 text-[12.5px]">
        <div className="text-[11px] text-[var(--theme-text-muted)]">
          {item.messages} message{item.messages === 1 ? '' : 's'} · last one {span(quietFor)} ago
          {inIntake && !t.released && ' · waits here while the conversation moves'}
        </div>
        {item.excerpt
          ? <p className="whitespace-pre-wrap break-words text-[var(--theme-text-primary)]">{item.excerpt}</p>
          : <p className="text-[var(--theme-text-muted)]">Nothing more came with it: open it where it lives.</p>}
        {t.note && <p className="text-[11px] text-[var(--theme-warning)]">{t.note}</p>}
      </div>
      <div className="flex flex-none flex-wrap items-center gap-1.5 border-t border-[var(--theme-border)] p-2">
        {item.url && <Button size="sm" variant="primary" onClick={() => window.open(item.url!, '_blank', 'noopener')}>Open in {source}</Button>}
        {t.phase === 'zone' && !t.released && <Button size="sm" onClick={() => void store.release(itemId)} title="Let an arm take it out now, without waiting for the conversation to be quiet">Release</Button>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { void store.archiveItem(itemId); onClose(); }} title="Junk, or done with: it leaves the floor. A new message brings it back">Archive</Button>
      </div>
    </div>
  );
});

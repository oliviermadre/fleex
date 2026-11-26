import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Modal } from '../components/ui/Modal';
import { MultiSelect } from '../components/ui/MultiSelect';
import { cn } from '../lib/cn';
import { factoryApi } from './factoryApi';
import { useFactoryStore } from './factoryStore';
import { FactoryPopup } from './FactoryPopup';
import { PeriodSelect, periodLabel } from './FactoryStatsBits';
import { TicketToken } from './FactoryTicketMeta';
import { shippedWhen } from './FactoryExitLog';
import { DeliveredBand, ItemContent } from './FactoryItemContent';
import { ItemVisits, useItemDeliverables, useItemVisits } from './ItemVisits';
import { ITEM_SOURCES, SOURCE_LABEL, sourceType, type ItemSource } from './items';
import type { ArchivedItem, ArchivedReason, FactoryTicketInfo, MachineSpec } from './types';

const REASON: Record<ArchivedReason, string> = { junk: 'by hand', exit: 'by an exit', dropped: 'dropped by a rule' };
const REASON_FILTER: Record<ArchivedReason, string> = { junk: 'By hand', exit: 'By an exit', dropped: 'Dropped by a rule' };
/* what the list shows unless asked: what went through the floor (picked on docs/factory/archived-items.html, dropped: A) */
const SHOWN: ArchivedReason[] = ['junk', 'exit'];

const infoOf = (i: ArchivedItem): FactoryTicketInfo => ({ id: i.itemId, displayId: 0, title: i.title, type: sourceType(i.source), priority: '', status: 'done', tags: i.tags, boardId: '', complexity: null, favorite: false, blocked: false });

/** How it left, in words: by hand, the exit by its name (when it was kept), dropped by a rule. */
export function howItLeft(i: Pick<ArchivedItem, 'reason' | 'exitId'>, machines: readonly MachineSpec[]): string {
  if (i.reason === 'exit' && i.exitId) { const m = machines.find((q) => q.id === i.exitId); return `Exit · ${m && 'name' in m && m.name ? m.name : 'removed since'}`; }
  return i.reason ? REASON[i.reason] : 'archived';
}

/** What the list is narrowed to: none of a criterion means all of it, but for `reasons`, which starts on what went through the floor. */
export interface ArchivedFilter { q: string; intakes: string[]; reasons: ArchivedReason[]; sources: string[] }
export function filterArchived(items: readonly ArchivedItem[], f: ArchivedFilter): ArchivedItem[] {
  const needle = f.q.trim().toLowerCase();
  return items.filter((i) => (!needle || i.title.toLowerCase().includes(needle) || i.author.toLowerCase().includes(needle))
    && (!f.intakes.length || f.intakes.includes(i.intakeId ?? ''))
    && (!f.reasons.length || f.reasons.includes(i.reason ?? 'junk'))
    && (!f.sources.length || f.sources.includes(i.source)));
}

/**
 * The items archived over the stats' period: by hand (Archive, Give back), by an exit (named when that was kept), or
 * dropped by a rule of their intake (hidden unless the filter asks for them), the latest first. From the floor's card
 * (every intake) or an intake's (`intakeId`: the filter starts on it). A line opens the item, read only; Bring back
 * puts it back in its intake. Picked on `docs/factory/archived-items.html` (A, A, A).
 */
export function FactoryArchivedItems({ intakeId, onOpenItem, onClose }: { intakeId: string | null; onOpenItem: (itemId: string) => void; onClose: () => void }) {
  const days = useFactoryStore((s) => s.statsDays), layout = useFactoryStore((s) => s.layout), bringBack = useFactoryStore((s) => s.bringBack);
  const machines = useMemo(() => layout?.machines ?? [], [layout]);
  const [items, setItems] = useState<ArchivedItem[] | null>(null), [failed, setFailed] = useState(false), [back, setBack] = useState<Set<string>>(new Set());
  const [f, setF] = useState<ArchivedFilter>({ q: '', intakes: intakeId ? [intakeId] : [], reasons: SHOWN, sources: [] });
  useEffect(() => {
    let live = true;
    factoryApi.archivedItems(days).then((r) => { if (live) { setItems(r.items); setFailed(false); } }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [days]);
  const set = (patch: Partial<ArchivedFilter>) => setF((cur) => ({ ...cur, ...patch }));
  const shown = useMemo(() => filterArchived(items ?? [], f).filter((i) => !back.has(i.itemId)), [items, f, back]);
  const intakeName = (id: string | null) => { const m = machines.find((q) => q.id === id); return m && m.kind === 'intake' ? m.name || `${SOURCE_LABEL[m.source]} intake` : 'removed since'; };
  const intakeOptions = [...new Set([...machines.filter((m) => m.kind === 'intake').map((m) => m.id), ...(items ?? []).map((i) => i.intakeId).filter((x): x is string => !!x)])].map((id) => ({ value: id, label: intakeName(id) }));
  const dropped = (items ?? []).filter((i) => i.reason === 'dropped' && !f.reasons.includes('dropped')).length;
  const title = intakeId ? `Archived · ${intakeName(intakeId)}` : 'Archived items';
  const guard = (node: React.ReactNode) => (
    <span data-modal-escape-local onKeyDown={(e) => { if (e.key === 'Escape' && (e.target as HTMLElement).getAttribute('aria-expanded') !== 'true') onClose(); }}>{node}</span>
  );
  const cols = 'grid grid-cols-[30px_minmax(0,2.4fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_112px_250px] items-center gap-x-3';
  const restore = async (i: ArchivedItem) => { await bringBack(i.itemId); setBack((cur) => new Set(cur).add(i.itemId)); };

  return (
    <Modal open onClose={onClose} maxWidth="max-w-[1400px]" variant="glass">
      <div className="flex h-[86vh] flex-col gap-3" role="region" aria-label={title}>
        <div className="flex flex-none items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-base font-semibold text-[var(--theme-text-primary)]">{title}</div>
            <p className="text-xs text-[var(--theme-text-muted)]">{periodLabel(days)}, the latest first.{dropped ? ` ${dropped} dropped by a rule, hidden: see "How it left".` : ''} Esc closes.</p>
          </div>
          <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
        </div>
        <div className="flex flex-none flex-wrap items-center gap-x-1 gap-y-1.5" role="search" aria-label="Filter the archived items">
          <Input id="factory-archived-find" type="search" value={f.q} placeholder="Title or sender" aria-label="Find by title or sender" autoComplete="off" onChange={(e) => set({ q: e.target.value })} className="w-56 py-1 text-xs" />
          <div className="w-40"><PeriodSelect id="factory-archived-period" /></div>
          {guard(<MultiSelect label="Intakes" values={f.intakes} options={intakeOptions} onChange={(v) => set({ intakes: v })} searchable={intakeOptions.length > 8} />)}
          {guard(<MultiSelect label="How it left" allLabel="Any way it left" values={f.reasons} options={(Object.keys(REASON_FILTER) as ArchivedReason[]).map((r) => ({ value: r, label: REASON_FILTER[r] }))} onChange={(v) => set({ reasons: v as ArchivedReason[] })} searchable={false} />)}
          {guard(<MultiSelect label="Sources" values={f.sources} options={ITEM_SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))} onChange={(v) => set({ sources: v })} searchable={false} />)}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-[var(--theme-border)]">
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="min-w-[960px]">
              <div className={cn(cols, 'sticky top-0 z-[1] border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-muted)]')} role="row">
                <span /><span>Item</span><span>From</span><span>Intake</span><span>How it left</span><span>When</span><span />
              </div>
              <div role="table" aria-label={title}>
                {!items && <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">{failed ? 'Could not read the archived items.' : 'Reading the archived items…'}</div>}
                {items && shown.length === 0 && <div className="py-12 text-center text-xs text-[var(--theme-text-muted)]">{items.length ? 'Nothing matches these filters.' : 'No item archived over the period.'}</div>}
                {shown.map((i) => (
                  <div key={i.itemId} role="row" className={cn(cols, 'border-b border-[var(--theme-border)] px-3 py-1.5 text-xs last:border-b-0 hover:bg-[var(--theme-bg-overlay)]')}>
                    <TicketToken info={infoOf(i)} size={22} />
                    <button type="button" className="min-w-0 text-left" onClick={() => onOpenItem(i.itemId)} title={i.title}>
                      <span className="block truncate font-medium text-[var(--theme-text-primary)] hover:underline"><span className="mr-1.5 font-mono font-normal text-[var(--theme-text-muted)]">{SOURCE_LABEL[i.source]}</span>{i.title}</span>
                    </button>
                    <span className="truncate text-[var(--theme-text-secondary)]" title={i.author}>{i.author || '–'}</span>
                    <span className="truncate text-[var(--theme-text-muted)]">{intakeName(i.intakeId)}</span>
                    <span><span className={cn('inline-block max-w-full truncate rounded-full border px-2 py-px text-[11px]',
                      i.reason === 'junk' ? 'border-[var(--theme-warning)] text-[var(--theme-warning)]' : i.reason === 'exit' ? 'border-[var(--theme-success)] text-[var(--theme-success)]' : 'border-[var(--theme-border-input)] text-[var(--theme-text-muted)]')}>{howItLeft(i, machines)}</span></span>
                    <span className="font-mono tabular-nums text-[var(--theme-text-secondary)]" title={new Date(i.archivedAt).toLocaleString()}>{shippedWhen(i.archivedAt)}</span>
                    <span className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => onOpenItem(i.itemId)}>Open</Button>
                      {i.url && <Button size="sm" variant="ghost" onClick={() => window.open(i.url!, '_blank', 'noopener')}>Open in {SOURCE_LABEL[i.source]}</Button>}
                      <Button size="sm" onClick={() => void restore(i)} title="Put it back in its intake: it goes its way again, with what it had">Bring back</Button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

/** An item as the Factory keeps it, read from the server (an archived one is not on the floor). */
interface KeptItem { id: string; source: ItemSource; title: string; author: string; url: string | null; tags: string[]; excerpt: string; messages: number; lastActivityAt: string; intakeId: string | null; machineId: string | null; archivedAt: string | null; archivedReason: ArchivedReason | null }

/**
 * An archived item, opened from the list: read only. What it delivered, its content (Text, Email), who it was from,
 * its tags, how it left, what the stations said. Bring back puts it in its intake again.
 */
export function FactoryArchivedItemPopup({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const machines = useFactoryStore((s) => s.layout?.machines ?? []), bringBack = useFactoryStore((s) => s.bringBack);
  const [item, setItem] = useState<KeptItem | null>(null), [missing, setMissing] = useState(false);
  const runs = useItemVisits(itemId), delivered = useItemDeliverables(runs);
  useEffect(() => {
    let live = true;
    Promise.resolve().then(() => factoryApi.item(itemId)).then((i) => { if (live) setItem(i as KeptItem); }, () => { if (live) setMissing(true); });
    return () => { live = false; };
  }, [itemId]);
  const source = item ? SOURCE_LABEL[item.source] : '';
  const bar = (
    <>
      {item && <TicketToken info={infoOf({ ...item, itemId: item.id, reason: item.archivedReason, exitId: null, archivedAt: item.archivedAt ?? '', createdAt: '', fields: {} })} size={22} />}
      <span className="min-w-0 flex-1 truncate text-sm"><b className="text-[var(--theme-text-primary)]">{item?.title ?? 'Item'}</b><span className="ml-2 text-xs text-[var(--theme-text-muted)]">{item?.archivedAt ? `${source} item · archived` : `${source} item`}</span></span>
      {item?.url && <Button size="sm" variant="secondary" onClick={() => window.open(item.url!, '_blank', 'noopener')}>Open in {source}</Button>}
      {item?.archivedAt && <Button size="sm" onClick={() => { void bringBack(itemId).then(onClose); }} title="Put it back in its intake: it goes its way again, with what it had">Bring back</Button>}
    </>
  );
  const Read = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex min-w-0 flex-col gap-0.5"><span className="text-xs font-medium text-[var(--theme-text-secondary)]">{label}</span><span className="truncate text-sm text-[var(--theme-text-primary)]">{children}</span></div>
  );
  return (
    <FactoryPopup label="Archived item" onClose={onClose} bar={bar} size="large" maxWidth="max-w-5xl">
      <DeliveredBand delivered={delivered} />
      {!item ? <p className="p-6 text-sm text-[var(--theme-text-muted)]">{missing ? 'This item is no longer kept.' : 'Reading it…'}</p> : (
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y divide-[var(--theme-border)] overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:divide-x lg:divide-y-0 lg:overflow-hidden">
          <div className="flex flex-col gap-3 p-4 lg:overflow-y-auto">
            <div className="grid grid-cols-2 gap-2">
              <Read label="From">{item.author || '–'}</Read>
              <Read label="How it left">{howItLeft({ reason: item.archivedReason, exitId: item.archivedReason === 'exit' ? item.machineId : null }, machines)}{item.archivedAt ? `, ${shippedWhen(item.archivedAt)}` : ''}</Read>
              <Read label="Intake">{(() => { const m = machines.find((q) => q.id === item.intakeId); return m && m.kind === 'intake' ? m.name || `${source} intake` : 'removed since'; })()}</Read>
              <Read label="Tags">{item.tags.join(' · ') || '–'}</Read>
            </div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">Content</div>
            <ItemContent itemId={itemId} excerpt={item.excerpt} version={item.lastActivityAt} />
          </div>
          <div className="flex flex-col gap-2 p-4 lg:overflow-y-auto">
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--theme-text-muted)]">What stations said</div>
            <ItemVisits runs={runs} links={false} empty="No station worked on it." />
          </div>
        </div>
      )}
    </FactoryPopup>
  );
}

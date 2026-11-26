import { useCallback, useEffect, useMemo, useState } from 'react';
import type { TicketDeliverable } from '@fleex/shared';
import { MarkdownRenderer } from '../components/scratchpad/MarkdownRenderer';
import { useUIStore } from '../stores/uiStore';
import * as api from '../services/api';
import { factoryApi } from './factoryApi';
import type { FactoryRun } from './types';

const noop = () => {};
/** How often the visits are read again while they are shown. */
const REFRESH_MS = 4000;
const STATUS_WORD: Record<FactoryRun['status'], string> = { running: 'working on it', completed: 'done', failed: 'failed', needs_review: 'waits for you', question: 'asked a question', interrupted: 'interrupted' };

/** An item's visits to stations, read while shown (`GET /api/factory/items/:id/runs`). */
export function useItemVisits(itemId: string): FactoryRun[] | null {
  const [runs, setRuns] = useState<FactoryRun[] | null>(null);
  const load = useCallback(async () => { try { setRuns(await factoryApi.itemRuns(itemId)); } catch { /* next time */ } }, [itemId]);
  useEffect(() => { setRuns(null); void load(); const id = window.setInterval(() => { if (!document.hidden) void load(); }, REFRESH_MS); return () => window.clearInterval(id); }, [load]);
  return runs;
}

/** What an item's stations delivered, the latest first: each visit that produced a deliverable, and the deliverable once read. */
export interface ItemDeliverable { run: FactoryRun; deliverable: TicketDeliverable | null }
const read = new Map<string, Promise<TicketDeliverable | null>>();
export function useItemDeliverables(runs: FactoryRun[] | null): ItemDeliverable[] {
  const made = useMemo(() => (runs ?? []).filter((r) => r.deliverableId).sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt)), [runs]);
  const [seen, setSeen] = useState<Record<string, TicketDeliverable | null>>({});
  useEffect(() => {
    let live = true;
    for (const r of made) {
      const id = r.deliverableId!;
      if (id in seen) continue;
      if (!read.has(id)) read.set(id, api.fetchDeliverable(id).catch(() => null));
      void read.get(id)!.then((d) => { if (live) setSeen((cur) => (id in cur ? cur : { ...cur, [id]: d })); });
    }
    return () => { live = false; };
  }, [made, seen]);
  return made.map((run) => ({ run, deliverable: seen[run.deliverableId!] ?? null }));
}

/** Open a deliverable over the page, as everywhere in Fleex. */
export function useOpenDeliverable(): (d: ItemDeliverable) => void {
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  return useCallback((d: ItemDeliverable) => {
    if (d.deliverable) { openDeliverable(d.deliverable); return; }
    void api.fetchDeliverable(d.run.deliverableId!).then(openDeliverable).catch(() => { /* the API helper raised a toast */ });
  }, [openDeliverable]);
}

/**
 * What the stations an item went through answered: an item has no thread, so its visits stand for one. Each: the
 * station, how it left the item, the agent's reply, the deliverable it produced. Shown on the item's card and in its popup.
 */
export function ItemVisits({ runs, empty, links = true }: { runs: FactoryRun[] | null; empty?: string; /** Each deliverable's link, where they are not shown on their own. */ links?: boolean }) {
  const openDeliverable = useUIStore((s) => s.openDeliverableOverlay);
  const said = (runs ?? []).filter((r) => r.reply || r.deliverableId || r.status !== 'running');
  const open = async (id: string) => { try { openDeliverable(await api.fetchDeliverable(id)); } catch { /* the API helper raised a toast */ } };
  if (!said.length) return empty ? <p className="text-xs text-[var(--theme-text-muted)]">{empty}</p> : null;
  return (
    <>
      {said.map((r) => (
        <div key={r.id} className="rounded-lg border border-[var(--theme-border)] px-2.5 py-1.5 text-[12.5px]">
          <div className="mb-0.5 flex items-center gap-1.5 text-[10.5px] text-[var(--theme-text-muted)]">
            <b className="text-[var(--theme-text-secondary)]">{r.machineName}</b>
            <span>· {r.outcome ? `left as "${r.outcome}"` : STATUS_WORD[r.status]}</span>
          </div>
          {r.reply && <div className="text-[var(--theme-text-primary)]"><MarkdownRenderer content={r.reply} onToggleCheckbox={noop} /></div>}
          {r.error && !r.reply && <div className="text-[11px] text-[var(--theme-danger)]">{r.error}</div>}
          {links && r.deliverableId && <button type="button" onClick={() => void open(r.deliverableId!)} className="mt-1 text-[11px] text-[var(--theme-accent)] hover:underline">Open what it delivered</button>}
        </div>
      ))}
    </>
  );
}

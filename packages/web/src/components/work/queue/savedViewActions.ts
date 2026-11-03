/**
 * What the Tasks view picker and the "modified" bar do — the glue between the
 * saved views (server, savedViewsStore) and the queue's applied config and
 * per-view drafts (workStore). No React: tested in savedViewActions.test.ts.
 */
import { toast } from '../../../lib/toast';
import { useSavedViewsStore, copyName, type SavedView } from '../../../stores/savedViewsStore';
import { useWorkStore } from '../../../stores/workStore';
import { normalizeConfig, sameConfig, type KnownIds, type QueueConfig } from '../queueFilters';

export const viewConfig = (v: Pick<SavedView, 'filters' | 'display'>): QueueConfig => ({
  filters: v.filters,
  display: v.display,
});

const views = () => useSavedViewsStore.getState().views;
const work = () => useWorkStore.getState();
const errorDetail = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The active saved view, or null on « All tasks » (or while it's unknown). */
export function activeView(): SavedView | null {
  const id = work().activeViewId;
  return id ? views().find((v) => v.id === id) ?? null : null;
}

/** Whether the queue shows something else than the active view as saved. « All tasks » is never modified. */
export function isViewDirty(view: SavedView | null, applied: QueueConfig, known: KnownIds): boolean {
  return !!view && !sameConfig(applied, viewConfig(view), known);
}

/** Show a view (null = « All tasks »), with its own unsaved edits when it has some. */
export function switchView(id: string | null): void {
  const view = id ? views().find((v) => v.id === id) ?? null : null;
  work().activateView(view ? view.id : null, view ? viewConfig(view) : null);
}

/**
 * Create a view from what the queue shows and make it active. Created from a
 * modified view (« New view… »), the edits move to the new view: the old one is
 * left as saved.
 */
export async function createView(name: string, emoji: string | null, known: KnownIds): Promise<boolean> {
  const { queueConfig, activeViewId } = work();
  const now = new Date().toISOString();
  const view: SavedView = {
    id: crypto.randomUUID(),
    name: name.trim(),
    emoji,
    ...normalizeConfig(queueConfig, known),
    createdAt: now,
    updatedAt: now,
  };
  try {
    await useSavedViewsStore.getState().commit([...views(), view]);
  } catch (err) {
    toast.error('View not created', { detail: errorDetail(err) });
    return false;
  }
  if (activeViewId) work().settleView(activeViewId, queueConfig);
  work().activateView(view.id, viewConfig(view));
  toast.success(`View "${view.name}" created`);
  return true;
}

/** Store the queue's config as the active view. On failure the edits are kept, still unsaved. */
export async function saveActiveView(known: KnownIds): Promise<boolean> {
  const view = activeView();
  if (!view) return false;
  const config = normalizeConfig(work().queueConfig, known);
  const next = views().map((v) => (v.id === view.id ? { ...v, ...config, updatedAt: new Date().toISOString() } : v));
  try {
    await useSavedViewsStore.getState().commit(next);
  } catch (err) {
    toast.error('View not saved', { detail: `${errorDetail(err)} — your changes are kept.` });
    return false;
  }
  work().settleView(view.id, config);
  toast.success(`View "${view.name}" saved`);
  return true;
}

/** Drop the active view's unsaved edits. */
export function resetActiveView(): void {
  const view = activeView();
  if (view) work().settleView(view.id, viewConfig(view));
}

export async function renameView(id: string, name: string, emoji: string | null): Promise<boolean> {
  const next = views().map((v) =>
    v.id === id ? { ...v, name: name.trim(), emoji, updatedAt: new Date().toISOString() } : v,
  );
  try {
    await useSavedViewsStore.getState().commit(next);
    return true;
  } catch (err) {
    toast.error('View not renamed', { detail: errorDetail(err) });
    return false;
  }
}

/** A copy of a view (as saved) right after it, under a free "(copy)" name. */
export async function duplicateView(id: string): Promise<void> {
  const list = views();
  const index = list.findIndex((v) => v.id === id);
  const source = list[index];
  if (!source) return;
  const now = new Date().toISOString();
  const copy: SavedView = { ...source, id: crypto.randomUUID(), name: copyName(source.name, list), createdAt: now, updatedAt: now };
  const next = [...list.slice(0, index + 1), copy, ...list.slice(index + 1)];
  try {
    await useSavedViewsStore.getState().commit(next);
    toast.success(`View "${copy.name}" created`);
  } catch (err) {
    toast.error('View not duplicated', { detail: errorDetail(err) });
  }
}

/** Delete a view (the queue falls back to « All tasks » when it was active), with an Undo. */
export async function deleteView(id: string): Promise<void> {
  const list = views();
  const index = list.findIndex((v) => v.id === id);
  const view = list[index];
  if (!view) return;
  const wasActive = work().activeViewId === id;
  try {
    await useSavedViewsStore.getState().commit(list.filter((v) => v.id !== id));
  } catch (err) {
    toast.error('View not deleted', { detail: errorDetail(err) });
    return;
  }
  work().forgetView(id);
  toast.info(`"${view.name}" deleted`, {
    action: {
      label: 'Undo',
      onClick: () => {
        const current = views();
        const restored = [...current.slice(0, index), view, ...current.slice(index)];
        useSavedViewsStore.getState().commit(restored).then(
          () => { if (wasActive) switchView(view.id); },
          (err) => toast.error('View not restored', { detail: errorDetail(err) }),
        );
      },
    },
  });
}

/**
 * After the views are (re)read: an active view that no longer exists (deleted
 * from another browser), or a storage without views, hands the queue back to
 * « All tasks » — with its own draft.
 */
export function reconcileActiveView(): void {
  const { status } = useSavedViewsStore.getState();
  const { activeViewId } = work();
  if (!activeViewId) return;
  // No views on this storage: back to « All tasks », the view's draft kept for later.
  if (status === 'unavailable') work().activateView(null, null);
  else if (status === 'ready' && !views().some((v) => v.id === activeViewId)) work().forgetView(activeViewId);
}

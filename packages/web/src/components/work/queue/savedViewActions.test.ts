import { describe, it, expect, beforeEach, vi } from 'vitest';

const server = vi.hoisted(() => ({
  views: [] as unknown[],
  failNext: null as null | { status: number; message: string },
  puts: 0,
}));

vi.mock('../../../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/api')>();
  const fail = () => {
    const f = server.failNext;
    server.failNext = null;
    if (f) throw new actual.SavedViewsError(f.message, f.status);
  };
  return {
    ...actual,
    fetchSavedViews: async () => {
      fail();
      return structuredClone(server.views);
    },
    saveSavedViews: async (_scope: string, views: unknown[]) => {
      fail();
      server.puts++;
      server.views = structuredClone(views);
      return structuredClone(views);
    },
  };
});

const toasts = vi.hoisted(() => [] as { tone: string; message: string; detail?: string; action?: { onClick: () => void } }[]);
vi.mock('../../../lib/toast', () => ({
  toast: {
    success: (message: string) => toasts.push({ tone: 'success', message }),
    error: (message: string, o?: { detail?: string }) => toasts.push({ tone: 'error', message, detail: o?.detail }),
    info: (message: string, o?: { action?: { onClick: () => void } }) => toasts.push({ tone: 'info', message, action: o?.action }),
  },
}));

import { useWorkStore } from '../../../stores/workStore';
import { useSavedViewsStore, viewNameError, copyName } from '../../../stores/savedViewsStore';
import { DEFAULT_QUEUE_CONFIG, DEFAULT_QUEUE_FILTERS, type KnownIds } from '../queueFilters';
import {
  activeView,
  createView,
  deleteView,
  duplicateView,
  isViewDirty,
  reconcileActiveView,
  renameView,
  resetActiveView,
  saveActiveView,
  switchView,
} from './savedViewActions';

const known: KnownIds = { boards: new Set(['odys', 'fleex', 'web']), epics: new Set() };
const work = () => useWorkStore.getState();
const filters = () => work().queueConfig.filters;
const dirty = () => isViewDirty(activeView(), work().queueConfig, known);

beforeEach(async () => {
  localStorage.clear();
  server.views = [];
  server.failNext = null;
  server.puts = 0;
  toasts.length = 0;
  useWorkStore.setState({ queueConfig: DEFAULT_QUEUE_CONFIG, activeViewId: null, viewDrafts: {}, search: '' });
  useSavedViewsStore.setState({ views: [], status: 'idle' });
  await useSavedViewsStore.getState().load();
});

/** Set filters on the queue then save them as a view. */
async function makeView(name: string, patch: Partial<typeof DEFAULT_QUEUE_FILTERS>, groupBy?: 'priority' | 'board') {
  switchView(null);
  work().setQueueFilters({ ...DEFAULT_QUEUE_FILTERS, statuses: [], ...patch });
  if (groupBy) work().setGroupBy(groupBy);
  await createView(name, null, known);
  return activeView()!;
}

describe('the three views of the ticket (AC11)', () => {
  it('are built once, then recalled in one click each', async () => {
    const odys = await makeView('ODYS AI', { boards: ['odys'] }, 'priority');
    const reviewing = await makeView('Reviewing', { statuses: ['reviewing'] });
    const doing = await makeView('Doing ODYS + Fleex', { boards: ['odys', 'fleex'], statuses: ['doing'] });

    switchView(odys.id);
    expect(filters()).toMatchObject({ boards: ['odys'], statuses: [] });
    expect(work().queueConfig.display.groupBy).toBe('priority');
    switchView(reviewing.id);
    expect(filters()).toMatchObject({ boards: [], statuses: ['reviewing'] });
    switchView(doing.id);
    expect(filters()).toMatchObject({ boards: ['fleex', 'odys'], statuses: ['doing'] });
    expect(dirty()).toBe(false);
  });
});

describe('creating a view (F1, AC10)', () => {
  it('stores the current config on the server and makes it active', async () => {
    work().setQueueFilters({ epics: ['none'], blocked: 'blocked' });
    work().setSearch('login');
    expect(await createView('Blocked', '🧊', known)).toBe(true);
    expect(server.views).toHaveLength(1);
    expect(work().activeViewId).toBe(activeView()!.id);
    expect(activeView()).toMatchObject({ name: 'Blocked', emoji: '🧊' });
    expect(activeView()!.filters).toMatchObject({ epics: ['none'], blocked: 'blocked' });
    // The search is never part of a view.
    expect(JSON.stringify(server.views)).not.toContain('login');
    expect(toasts.at(-1)).toMatchObject({ tone: 'success', message: 'View "Blocked" created' });
  });

  it('refuses empty, too long and duplicate names', async () => {
    await makeView('ODYS AI', { boards: ['odys'] });
    const views = useSavedViewsStore.getState().views;
    expect(viewNameError('   ', views)).toMatch(/required/);
    expect(viewNameError('x'.repeat(61), views)).toMatch(/60/);
    expect(viewNameError('odys ai', views)).toMatch(/already/);
    // Renaming a view to its own name is fine.
    expect(viewNameError('ODYS AI', views, views[0]!.id)).toBeNull();
  });
});

describe('modified view (F3, AC12)', () => {
  it('changing a filter or the display marks the view modified; the search never does', async () => {
    await makeView('ODYS AI', { boards: ['odys'] });
    work().setSearch('agent');
    expect(dirty()).toBe(false);
    work().setQueueDisplay({ subGroupBy: 'status' });
    expect(dirty()).toBe(true);
  });

  it('Save stores the edits on the view and clears the modified state', async () => {
    const v = await makeView('ODYS AI', { boards: ['odys'] });
    work().setQueueFilters({ prs: ['none'] });
    expect(await saveActiveView(known)).toBe(true);
    expect(dirty()).toBe(false);
    expect((server.views[0] as typeof v).filters.prs).toEqual(['none']);
  });

  it('Reset brings the saved view back', async () => {
    await makeView('ODYS AI', { boards: ['odys'] });
    work().setQueueFilters({ boards: ['web'] });
    resetActiveView();
    expect(filters().boards).toEqual(['odys']);
    expect(dirty()).toBe(false);
  });

  it('New view… forks the edits into a new active view, the old one stays as saved and clean', async () => {
    const odys = await makeView('ODYS AI', { boards: ['odys'] });
    work().setQueueFilters({ types: ['fix'] });
    await createView('ODYS fixes', null, known);
    expect(activeView()!.name).toBe('ODYS fixes');
    expect(activeView()!.filters.types).toEqual(['fix']);
    switchView(odys.id);
    expect(filters().types).toEqual([]);
    expect(dirty()).toBe(false);
  });

  it('an unsaved edit survives going to another view and back', async () => {
    const odys = await makeView('ODYS AI', { boards: ['odys'] });
    const rev = await makeView('Reviewing', { statuses: ['reviewing'] });
    switchView(odys.id);
    work().setQueueFilters({ types: ['fix'] });
    switchView(rev.id);
    switchView(odys.id);
    expect(filters().types).toEqual(['fix']);
    expect(dirty()).toBe(true);
  });

  // F4
  it('a failed save keeps the edits and the modified state, and says so', async () => {
    await makeView('ODYS AI', { boards: ['odys'] });
    work().setQueueFilters({ types: ['fix'] });
    server.failNext = { status: 503, message: 'Service unavailable' };
    expect(await saveActiveView(known)).toBe(false);
    expect(filters().types).toEqual(['fix']);
    expect(dirty()).toBe(true);
    expect(toasts.at(-1)).toMatchObject({ tone: 'error', message: 'View not saved' });
    expect(toasts.at(-1)!.detail).toMatch(/kept/);
  });
});

describe('rename, duplicate, delete (AC10, AC15)', () => {
  it('renames and duplicates under a free name', async () => {
    const v = await makeView('ODYS AI', { boards: ['odys'] });
    await renameView(v.id, 'ODYS', '🔭');
    expect(activeView()).toMatchObject({ name: 'ODYS', emoji: '🔭' });
    await duplicateView(v.id);
    await duplicateView(v.id);
    expect(useSavedViewsStore.getState().views.map((x) => x.name)).toEqual(['ODYS', 'ODYS (copy 2)', 'ODYS (copy)']);
    expect(copyName('ODYS', [{ name: 'odys (COPY)' }])).toBe('ODYS (copy 2)');
  });

  it('deleting the active view falls back to « All tasks » with its own config; Undo restores it', async () => {
    switchView(null);
    work().setQueueFilters({ boards: ['web'] });
    const v = await makeView('ODYS AI', { boards: ['odys'] });
    switchView(null);
    work().setQueueFilters({ boards: ['web'] });
    switchView(v.id);
    await deleteView(v.id);
    expect(work().activeViewId).toBeNull();
    expect(filters().boards).toEqual(['web']);
    expect(server.views).toHaveLength(0);

    toasts.at(-1)!.action!.onClick();
    await vi.waitFor(() => expect(work().activeViewId).toBe(v.id));
    expect(server.views).toHaveLength(1);
  });

  it('a view deleted from another browser hands the queue back to « All tasks » on the next read', async () => {
    const v = await makeView('ODYS AI', { boards: ['odys'] });
    server.views = [];
    await useSavedViewsStore.getState().load();
    reconcileActiveView();
    expect(work().activeViewId).toBeNull();
    expect(work().viewDrafts[v.id]).toBeUndefined();
  });
});

describe('storage without saved views (AC17)', () => {
  it('a 501 marks views unavailable and returns to « All tasks »; filters keep working', async () => {
    const v = await makeView('ODYS AI', { boards: ['odys'] });
    expect(work().activeViewId).toBe(v.id);
    server.failNext = { status: 501, message: 'Saved views are unavailable on this storage' };
    await useSavedViewsStore.getState().load();
    expect(useSavedViewsStore.getState().status).toBe('unavailable');
    reconcileActiveView();
    expect(work().activeViewId).toBeNull();
    work().setQueueFilters({ types: ['fix'] });
    expect(filters().types).toEqual(['fix']);
  });
});

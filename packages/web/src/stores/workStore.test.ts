import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkStore, TIMELINE_MAX_HEIGHT, migrateQueue, ALL_TASKS_VIEW } from './workStore';
import { DEFAULT_QUEUE_CONFIG, DEFAULT_QUEUE_FILTERS } from '../components/work/queueFilters';

// Each ticket keeps its own center mode, shell split and pane bindings — switching
// tickets must never apply one ticket's shells or layout to another.
describe('workStore — per-ticket memory', () => {
  const s = () => useWorkStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useWorkStore.setState({
      modeByTicket: {},
      modeTicketId: null,
      shellMode: false,
      codeMode: false,
      workflowMode: false,
      shellLayoutByTicket: {},
      shellPaneIdsByTicket: {},
      activeScratchTabByTicket: {},
    });
  });

  it("restores each ticket's own center mode, and chat for a ticket never switched", () => {
    s().restoreTicketMode('A');
    s().setShellMode(true);
    s().restoreTicketMode('B');
    s().setCodeMode(true);

    s().restoreTicketMode('C');
    expect([s().shellMode, s().codeMode, s().workflowMode]).toEqual([false, false, false]);

    s().restoreTicketMode('A');
    expect([s().shellMode, s().codeMode]).toEqual([true, false]);

    s().restoreTicketMode('B');
    expect([s().shellMode, s().codeMode]).toEqual([false, true]);
  });

  it('drops a ticket from the mode memory once it is back to chat', () => {
    s().restoreTicketMode('A');
    s().setWorkflowMode(true);
    expect(s().modeByTicket).toEqual({ A: 'workflow' });
    s().setWorkflowMode(false);
    expect(s().modeByTicket).toEqual({});
  });

  it('keeps shell layouts and pane bindings separate per ticket', () => {
    s().setShellLayout('A', 'grid');
    s().setShellLayout('B', 'cols');
    s().bindShellPane('A', 0, 'a1');
    s().bindShellPane('B', 0, 'b1');

    expect(s().shellLayoutByTicket).toEqual({ A: 'grid', B: 'cols' });
    expect(s().shellPaneIdsByTicket).toEqual({ A: ['a1'], B: ['b1'] });
  });

  it("moves a session between one ticket's panes without touching another ticket", () => {
    s().bindShellPane('A', 0, 'a1');
    s().bindShellPane('B', 0, 'b1');
    s().bindShellPane('A', 1, 'a1');

    expect(s().shellPaneIdsByTicket.A).toEqual([null, 'a1']);
    expect(s().shellPaneIdsByTicket.B).toEqual(['b1']);
  });

  it('forgetTicket drops everything remembered for that ticket only', () => {
    s().restoreTicketMode('A');
    s().setShellMode(true);
    s().setShellLayout('A', 'three');
    s().bindShellPane('A', 0, 'a1');
    s().setActiveScratchTab('A', 'org/repo');
    s().setShellLayout('B', 'rows');

    s().forgetTicket('A');

    expect(s().modeByTicket).toEqual({});
    expect(s().modeTicketId).toBeNull();
    expect(s().shellLayoutByTicket).toEqual({ B: 'rows' });
    expect(s().shellPaneIdsByTicket).toEqual({});
    expect(s().activeScratchTabByTicket).toEqual({});
  });

  it('persists the per-ticket memory to localStorage', () => {
    s().setShellLayout('A', 'three');
    s().bindShellPane('A', 2, 'a1');
    const stored = JSON.parse(localStorage.getItem('fleex_work')!);
    expect(stored.shellLayoutByTicket).toEqual({ A: 'three' });
    expect(stored.shellPaneIdsByTicket).toEqual({ A: [null, null, 'a1'] });
  });
});

// Creating several tasks in a row usually happens on the same board, so the
// draft forgets what was typed and picked but keeps the board it was created on.
describe('workStore — new task draft', () => {
  const s = () => useWorkStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useWorkStore.setState({
      draft: {
        title: '', text: '', stage: 'entry', source: null,
        repoKeys: [], repoBaseBranches: {}, repoCheckoutRefs: {},
        epicIds: [], boardId: null, type: 'build', priority: 'none', complexity: null,
      },
    });
  });

  it('keeps the board when the draft is reset after a task was created', () => {
    s().updateDraft({
      text: 'Fix the login',
      boardId: 'board-2',
      epicIds: ['epic-1'],
      repoKeys: ['acme/web'],
      repoBaseBranches: { 'acme/web': 'develop' },
      type: 'fix',
      priority: 'high',
    });

    s().resetDraft();

    expect(s().draft).toEqual({
      title: '',
      text: '',
      stage: 'entry',
      source: null,
      repoKeys: [],
      repoBaseBranches: {},
      repoCheckoutRefs: {},
      epicIds: [],
      boardId: 'board-2',
      type: 'build',
      priority: 'none',
      complexity: null,
    });
  });

  it('starts with no epic when restoring a draft saved before epics were pickable', async () => {
    localStorage.setItem('fleex_work', JSON.stringify({ draft: { text: 'hello', boardId: 'board-1' } }));
    vi.resetModules();
    const { useWorkStore: fresh } = await import('./workStore');

    expect(fresh.getState().draft).toMatchObject({ text: 'hello', boardId: 'board-1', epicIds: [] });
  });
});

// Every "open this session" action (a floating terminal's title bar, a new task,
// the palette) lands here. Composing selectTicket + setMode would write the shell
// mode onto the *previous* ticket and lose it on restore — the store does it in
// one commit instead.
describe('workStore — openShellForTicket / openTicket', () => {
  const s = () => useWorkStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useWorkStore.setState({
      selectedTicketId: 'OTHER',
      view: 'new',
      modeByTicket: { OTHER: 'code' },
      modeTicketId: 'OTHER',
      shellMode: false,
      codeMode: true,
      workflowMode: false,
      shellLayoutByTicket: {},
      shellPaneIdsByTicket: {},
      pinnedTicketId: null,
      shellFocusRequest: null,
      queueConfig: { ...DEFAULT_QUEUE_CONFIG, filters: { ...DEFAULT_QUEUE_FILTERS, boards: ['ODYS'] } },
      activeViewId: null,
    });
  });

  it('selects the ticket in shell mode, remembered for that ticket', () => {
    s().openShellForTicket('A', 's1');
    expect(s().selectedTicketId).toBe('A');
    expect(s().view).toBe('task');
    expect(s().modeTicketId).toBe('A');
    expect([s().shellMode, s().codeMode, s().workflowMode]).toEqual([true, false, false]);
    expect(s().modeByTicket.A).toBe('shell');

    // Leaving and coming back reopens the shell (the WorkView restore path).
    s().restoreTicketMode('OTHER');
    s().restoreTicketMode('A');
    expect(s().shellMode).toBe(true);
  });

  it("never changes another ticket's mode", () => {
    s().openShellForTicket('A', 's1');
    expect(s().modeByTicket.OTHER).toBe('code');
  });

  it('binds the session into the first empty pane without moving the others', () => {
    useWorkStore.setState({ shellLayoutByTicket: { A: 'three' }, shellPaneIdsByTicket: { A: ['x', null, 'y'] } });
    s().openShellForTicket('A', 's1');
    expect(s().shellPaneIdsByTicket.A).toEqual(['x', 's1', 'y']);
  });

  it('falls back to the first pane when every pane is taken', () => {
    useWorkStore.setState({ shellLayoutByTicket: { A: 'cols' }, shellPaneIdsByTicket: { A: ['x', 'y'] } });
    s().openShellForTicket('A', 's1');
    expect(s().shellPaneIdsByTicket.A).toEqual(['s1', 'y']);
  });

  it('is idempotent when the session is already in a pane', () => {
    useWorkStore.setState({ shellLayoutByTicket: { A: 'cols' }, shellPaneIdsByTicket: { A: ['x', 's1'] } });
    s().openShellForTicket('A', 's1');
    s().openShellForTicket('A', 's1');
    expect(s().shellPaneIdsByTicket.A).toEqual(['x', 's1']);
  });

  it('asks the pane to take the keyboard, and pins the ticket in the queue', () => {
    s().openShellForTicket('A', 's1');
    expect(s().shellFocusRequest).toBe('s1');
    expect(s().pinnedTicketId).toBe('A');
  });

  it('openTicket applies the given mode to that ticket only, chat forgetting it', () => {
    s().openTicket('A', 'workflow');
    expect(s().modeByTicket).toEqual({ OTHER: 'code', A: 'workflow' });
    expect(s().workflowMode).toBe(true);
    s().openTicket('A', 'chat');
    expect(s().modeByTicket).toEqual({ OTHER: 'code' });
    expect([s().shellMode, s().codeMode, s().workflowMode]).toEqual([false, false, false]);
  });

  // The user refused "mirroring": opening a ticket from outside must never
  // rewrite the queue filters they chose — the pin shows it instead.
  it('openTicket pins the ticket and leaves the filters (memory and storage) untouched', () => {
    s().setStatusFilters(['doing', 'reviewing']);
    const stored = JSON.parse(localStorage.getItem('fleex_work')!);
    s().openTicket('A', 'chat');
    expect(s().pinnedTicketId).toBe('A');
    expect(s().queueConfig.filters.boards).toEqual(['ODYS']);
    expect(s().queueConfig.filters.statuses).toEqual(['doing', 'reviewing']);
    const after = JSON.parse(localStorage.getItem('fleex_work')!);
    expect(after.queueConfig).toEqual(stored.queueConfig);
    expect(after.pinnedTicketId).toBe('A');
  });

  it('openTicket with pin: false selects without touching the pin', () => {
    s().pinTicket('P');
    s().openTicket('A', 'chat', { pin: false });
    expect(s().selectedTicketId).toBe('A');
    expect(s().pinnedTicketId).toBe('P');
  });

  it('picking another queue row keeps the pin (the ticket that brought you here stays)', () => {
    s().openTicket('A', 'chat');
    s().selectTicket('B');
    expect(s().selectedTicketId).toBe('B');
    expect(s().pinnedTicketId).toBe('A');
  });

  it('a second outside open replaces the pin — one slot', () => {
    s().openTicket('A', 'chat');
    s().openTicket('B', 'chat');
    expect(s().pinnedTicketId).toBe('B');
  });

  it('unpinTicket drops the pin; forgetting the pinned ticket drops it too', () => {
    s().pinTicket('A');
    s().unpinTicket();
    expect(s().pinnedTicketId).toBeNull();
    s().pinTicket('A');
    s().forgetTicket('B');
    expect(s().pinnedTicketId).toBe('A');
    s().forgetTicket('A');
    expect(s().pinnedTicketId).toBeNull();
  });
});

// The shell drawer and the Timeline share the one bottom slot of the Work view:
// showing both would stack two drawers and squash the center, so the store must
// make that state unreachable — from the buttons, from ⌘J, and from a stale blob.
describe('workStore — one bottom panel at a time', () => {
  const s = () => useWorkStore.getState();

  beforeEach(() => {
    localStorage.clear();
    useWorkStore.setState({ shellOpen: false, timelineOpen: false });
  });

  it('opening the Timeline closes the shell drawer', () => {
    s().setShellOpen(true);
    s().setTimelineOpen(true);
    expect([s().shellOpen, s().timelineOpen]).toEqual([false, true]);
  });

  it('opening the shell drawer (button or ⌘J) closes the Timeline', () => {
    s().setTimelineOpen(true);
    s().setShellOpen(true);
    expect([s().shellOpen, s().timelineOpen]).toEqual([true, false]);
  });

  it('closing one never reopens the other', () => {
    s().setTimelineOpen(true);
    s().setTimelineOpen(false);
    expect([s().shellOpen, s().timelineOpen]).toEqual([false, false]);
  });

  it('shell mode (center takeover) is not a bottom panel and leaves the Timeline open', () => {
    s().setTimelineOpen(true);
    s().setShellMode(true);
    expect(s().timelineOpen).toBe(true);
    s().setShellMode(false);
  });

  it('clamps the Timeline height and persists it with the open state and filters', () => {
    s().setTimelineHeight(10);
    expect(s().timelineHeight).toBe(160);
    s().setTimelineHeight(9999);
    expect(s().timelineHeight).toBe(TIMELINE_MAX_HEIGHT);
    s().setTimelineOpen(true);
    s().toggleTimelineFilter('comments');
    const stored = JSON.parse(localStorage.getItem('fleex_work')!);
    expect(stored.timelineOpen).toBe(true);
    expect(stored.timelineHeight).toBe(TIMELINE_MAX_HEIGHT);
    expect(stored.timelineFilters.comments).toBe(false);
    expect(stored.timelineFilters.status).toBe(true);
    s().toggleTimelineFilter('comments');
  });

  it('persists the frieze zoom, snapped to a known level', () => {
    s().setTimelineZoom(4);
    expect(s().timelineZoom).toBe(4);
    expect(JSON.parse(localStorage.getItem('fleex_work')!).timelineZoom).toBe(4);
    s().setTimelineZoom(3.1); // between levels → nearest
    expect(s().timelineZoom).toBe(4);
    s().setTimelineZoom(1);
  });

  it('defaults the zoom to ×1 for an old blob, and repairs a garbage one', async () => {
    localStorage.setItem('fleex_work', JSON.stringify({ timelineZoom: 'abc' }));
    vi.resetModules();
    expect((await import('./workStore')).useWorkStore.getState().timelineZoom).toBe(1);
  });

  it('repairs a stored blob that had both bottom panels open (the shell wins)', async () => {
    localStorage.setItem('fleex_work', JSON.stringify({ shellOpen: true, timelineOpen: true, timelineHeight: 5 }));
    vi.resetModules();
    const { useWorkStore: fresh } = await import('./workStore');
    const st = fresh.getState();
    expect([st.shellOpen, st.timelineOpen]).toEqual([true, false]);
    expect(st.timelineHeight).toBe(160);
    expect(st.timelineFilters).toEqual({ status: true, cli: true, pr: true, deliverables: true, comments: true, annotations: true, todos: true, exchanges: true });
  });
});

// Saved views: an existing user upgrading sees the same queue (AC16).
describe('migrateQueue — pre-views fleex_work blobs', () => {
  it('turns the flat filters and groupBy into « All tasks » config, new fields at their defaults', () => {
    const migrated = migrateQueue({
      boardFilters: ['b1'],
      statusFilters: ['todo'],
      priorityFilters: ['high'],
      favoriteOnly: true,
      groupBy: 'repo',
    } as never);
    expect(migrated.activeViewId).toBeNull();
    expect(migrated.queueConfig.filters).toEqual({
      ...DEFAULT_QUEUE_FILTERS,
      boards: ['b1'],
      statuses: ['todo'],
      priorities: ['high'],
      favoriteOnly: true,
    });
    expect(migrated.queueConfig.display).toEqual({ ...DEFAULT_QUEUE_CONFIG.display, groupBy: 'repo' });
    expect(migrated.viewDrafts[ALL_TASKS_VIEW]).toEqual(migrated.queueConfig);
  });

  it('a blob with no queue fields at all gets the defaults (doing + reviewing, by activity)', () => {
    expect(migrateQueue({}).queueConfig).toEqual(DEFAULT_QUEUE_CONFIG);
  });

  it('a current blob is kept, completed with any field added since', () => {
    const migrated = migrateQueue({
      queueConfig: { filters: { boards: ['b2'] }, display: { groupBy: 'epic' } },
      activeViewId: 'v1',
      viewDrafts: { v1: { filters: { types: ['fix'] } } },
    } as never);
    expect(migrated.activeViewId).toBe('v1');
    expect(migrated.queueConfig.filters).toEqual({ ...DEFAULT_QUEUE_FILTERS, boards: ['b2'] });
    expect(migrated.viewDrafts.v1!.filters.types).toEqual(['fix']);
  });
});

// Every view, « All tasks » included, keeps its own unsaved edits in the browser.
describe('per-view drafts', () => {
  const s = () => useWorkStore.getState();
  const saved = (boards: string[]) => ({ ...DEFAULT_QUEUE_CONFIG, filters: { ...DEFAULT_QUEUE_FILTERS, boards } });

  beforeEach(() => {
    localStorage.clear();
    useWorkStore.setState({ queueConfig: DEFAULT_QUEUE_CONFIG, activeViewId: null, viewDrafts: {} });
  });

  it('an edit to a view survives switching to another view and back', () => {
    s().activateView('v1', saved(['odys']));
    s().setQueueFilters({ types: ['fix'] });
    s().activateView('v2', saved(['fleex']));
    expect(s().queueConfig.filters.boards).toEqual(['fleex']);
    s().activateView('v1', saved(['odys']));
    expect(s().queueConfig.filters).toMatchObject({ boards: ['odys'], types: ['fix'] });
  });

  it('« All tasks » gets its own config back, not the last view\'s', () => {
    s().setQueueFilters({ boards: ['mine'] });
    s().activateView('v1', saved(['odys']));
    s().activateView(null, null);
    expect(s().queueConfig.filters.boards).toEqual(['mine']);
  });

  it('drafts are persisted, so they survive a reload (AC13)', () => {
    s().activateView('v1', saved(['odys']));
    s().setQueueFilters({ prs: ['none'] });
    const stored = JSON.parse(localStorage.getItem('fleex_work')!);
    expect(stored.activeViewId).toBe('v1');
    expect(stored.viewDrafts.v1.filters.prs).toEqual(['none']);
  });

  it('settleView (Save / Reset) applies the config and drops the draft', () => {
    s().activateView('v1', saved(['odys']));
    s().setQueueFilters({ types: ['fix'] });
    s().settleView('v1', saved(['odys']));
    expect(s().queueConfig.filters.types).toEqual([]);
    expect(s().viewDrafts.v1).toBeUndefined();
  });

  it('forgetting the active view falls back to « All tasks » with its own config (AC15)', () => {
    s().setQueueFilters({ boards: ['mine'] });
    s().activateView('v1', saved(['odys']));
    s().forgetView('v1');
    expect(s().activeViewId).toBeNull();
    expect(s().queueConfig.filters.boards).toEqual(['mine']);
  });

  it('setGroupBy on the sub-group value drops the sub-group (AC8)', () => {
    s().setQueueDisplay({ groupBy: 'priority', subGroupBy: 'status' });
    s().setGroupBy('status');
    expect(s().queueConfig.display).toMatchObject({ groupBy: 'status', subGroupBy: null });
    s().setQueueDisplay({ subGroupBy: 'status' });
    expect(s().queueConfig.display.subGroupBy).toBeNull();
  });
});

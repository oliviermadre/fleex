import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkStore, filtersRevealing } from './workStore';

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
        epicIds: [], boardId: null, type: 'build', priority: 'none',
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
      revealTicketId: null,
      shellFocusRequest: null,
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

  it('asks the pane to take the keyboard, and the queue to reveal the ticket', () => {
    s().openShellForTicket('A', 's1');
    expect(s().shellFocusRequest).toBe('s1');
    expect(s().revealTicketId).toBe('A');
  });

  it('openTicket applies the given mode to that ticket only, chat forgetting it', () => {
    s().openTicket('A', 'workflow');
    expect(s().modeByTicket).toEqual({ OTHER: 'code', A: 'workflow' });
    expect(s().workflowMode).toBe(true);
    s().openTicket('A', 'chat');
    expect(s().modeByTicket).toEqual({ OTHER: 'code' });
    expect([s().shellMode, s().codeMode, s().workflowMode]).toEqual([false, false, false]);
  });

  it('a hand-picked selection cancels a pending reveal', () => {
    s().openTicket('A', 'chat');
    s().selectTicket('B');
    expect(s().revealTicketId).toBeNull();
  });
});

describe('filtersRevealing', () => {
  const none = { boardFilters: [], statusFilters: [], priorityFilters: [], favoriteOnly: false, search: '' };
  const ticket = { boardId: 'b1', status: 'todo', priority: 'low', favorite: false, title: 'Fix login' };

  it('is null when the ticket already passes the filters', () => {
    expect(filtersRevealing(none, ticket)).toBeNull();
    expect(filtersRevealing({ ...none, statusFilters: ['todo'], boardFilters: ['b1'], search: 'login' }, ticket)).toBeNull();
  });

  it("adds the ticket's status to the status filter instead of wiping it", () => {
    expect(filtersRevealing({ ...none, statusFilters: ['doing', 'reviewing'] }, ticket)).toEqual({
      statusFilters: ['doing', 'reviewing', 'todo'],
    });
  });

  it('clears only the filters that exclude the ticket', () => {
    expect(
      filtersRevealing(
        { boardFilters: ['b2'], statusFilters: ['todo'], priorityFilters: ['high'], favoriteOnly: true, search: 'zzz' },
        ticket,
      ),
    ).toEqual({ boardFilters: [], priorityFilters: [], favoriteOnly: false, search: '' });
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
    expect(s().timelineHeight).toBe(360);
    s().setTimelineOpen(true);
    s().toggleTimelineFilter('comments');
    const stored = JSON.parse(localStorage.getItem('fleex_work')!);
    expect(stored.timelineOpen).toBe(true);
    expect(stored.timelineHeight).toBe(360);
    expect(stored.timelineFilters.comments).toBe(false);
    expect(stored.timelineFilters.status).toBe(true);
    s().toggleTimelineFilter('comments');
  });

  it('repairs a stored blob that had both bottom panels open (the shell wins)', async () => {
    localStorage.setItem('fleex_work', JSON.stringify({ shellOpen: true, timelineOpen: true, timelineHeight: 5 }));
    vi.resetModules();
    const { useWorkStore: fresh } = await import('./workStore');
    const st = fresh.getState();
    expect([st.shellOpen, st.timelineOpen]).toEqual([true, false]);
    expect(st.timelineHeight).toBe(160);
    expect(st.timelineFilters).toEqual({ status: true, cli: true, pr: true, deliverables: true, comments: true });
  });
});

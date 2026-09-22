import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useWorkStore } from './workStore';

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
        epicIds: [], boardId: null, type: 'build', priority: 'none', startWithAssistant: true,
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
      startWithAssistant: true,
    });
  });

  it('starts with no epic when restoring a draft saved before epics were pickable', async () => {
    localStorage.setItem('fleex_work', JSON.stringify({ draft: { text: 'hello', boardId: 'board-1' } }));
    vi.resetModules();
    const { useWorkStore: fresh } = await import('./workStore');

    expect(fresh.getState().draft).toMatchObject({ text: 'hello', boardId: 'board-1', epicIds: [] });
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { useWorkStore } from '../../stores/workStore';

// The layout is under test, not the panes: each child is a labelled stub.
const task = { id: 't1', number: 1, title: 'T', boardName: 'B', status: 'doing', type: 'build' };
vi.mock('./useWorkQueue', () => ({
  useWorkQueue: () => ({ selectedTask: task, orderedIds: ['t1'], counts: { total: 1 } }),
}));
vi.mock('./keyboard', () => ({ useWorkKeyboard: () => {} }));
vi.mock('./panel/useTicketDeliverables', () => ({
  useTicketDeliverables: () => ({ deliverables: [], removeDeliverable: () => {} }),
}));
vi.mock('./panel/useTicketMentions', () => ({ useTicketMentions: () => ({ mentions: [], openCount: 0 }) }));
vi.mock('./queue/WorkQueue', () => ({ WorkQueue: () => <aside data-testid="queue" /> }));
vi.mock('./queue/CollapsedQueueRail', () => ({ CollapsedQueueRail: () => <aside data-testid="queue" /> }));
vi.mock('./WorkTopBar', () => ({ WorkTopBar: () => <header data-testid="top-bar" /> }));
vi.mock('./WorkStatusBar', () => ({ WorkStatusBar: () => <footer data-testid="status-bar" /> }));
vi.mock('./task/TaskPane', () => ({ TaskPane: () => <div data-testid="task-pane" /> }));
vi.mock('./panel/ToolStrip', () => ({ ToolStrip: () => <nav data-testid="tool-strip" /> }));
vi.mock('./panel/RightPanel', () => ({ RightPanel: () => <section data-testid="right-panel" /> }));
vi.mock('./shell/ShellDrawer', () => ({ ShellDrawer: () => <div data-testid="shell-drawer" /> }));
vi.mock('./timeline/TimelineDrawer', () => ({ TimelineDrawer: () => <div data-testid="timeline-drawer" /> }));
vi.mock('../../stores/workflowRunStore', () => {
  const state = { runsByTicket: {}, loadForTicket: async () => {} };
  const useWorkflowRunStore = (sel: (s: typeof state) => unknown) => sel(state);
  useWorkflowRunStore.getState = () => state;
  return { useWorkflowRunStore };
});

const { WorkView } = await import('./WorkView');

beforeEach(() => {
  useWorkStore.setState({ view: 'task', selectedTicketId: 't1', shellOpen: false, shellMode: false, timelineOpen: false });
});
afterEach(cleanup);

/**
 * The bottom band (Shell or Timeline) must be a full-width strip: it runs under
 * the task queue too, from the nav rail to the tool strip. Before, it lived in
 * the center column, so the queue ate its left part. These tests pin the
 * geometry through the DOM: the band must not be nested in the queue's or the
 * center's column, and the tool strip must stay outside it (it holds the very
 * buttons that toggle the band).
 */
describe('WorkView bottom drawer layout', () => {
  it.each([
    ['Shell', { shellOpen: true }, 'shell-drawer'],
    ['Timeline', { timelineOpen: true }, 'timeline-drawer'],
  ])('the %s drawer spans under the queue, beside the tool strip', (_name, state, testId) => {
    useWorkStore.setState(state);
    render(<WorkView />);

    const band = screen.getByTestId('work-bottom-drawer');
    expect(band.contains(screen.getByTestId(testId))).toBe(true);

    // Same grid as the queue and the center, as a sibling — not inside either.
    const grid = band.parentElement!;
    for (const id of ['queue', 'task-pane', 'top-bar', 'tool-strip']) {
      const el = screen.getByTestId(id);
      expect(grid.contains(el)).toBe(true);
      expect(band.contains(el)).toBe(false);
      expect(el.contains(band)).toBe(false);
    }
    // It starts at the first column (the queue's) and stops before the tool strip's.
    expect(band.className).toContain('col-start-1');
    expect(band.className).toContain('col-span-2');
    expect(screen.getByTestId('queue').parentElement!.className).toContain('col-start-1');
    expect(screen.getByTestId('tool-strip').parentElement!.className).toContain('col-start-3');
  });

  it('renders no band when neither drawer is open', () => {
    render(<WorkView />);
    expect(screen.queryByTestId('work-bottom-drawer')).toBeNull();
  });

  it('renders no band when the shell already takes the center', () => {
    useWorkStore.setState({ shellOpen: true, shellMode: true, modeByTicket: { t1: 'shell' } });
    render(<WorkView />);
    expect(screen.queryByTestId('work-bottom-drawer')).toBeNull();
  });
});

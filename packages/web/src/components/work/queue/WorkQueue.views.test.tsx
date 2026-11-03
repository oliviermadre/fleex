import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, within, fireEvent } from '@testing-library/react';

vi.mock('../../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../services/api')>()),
  fetchSavedViews: async () => [],
}));

import { useWorkStore } from '../../../stores/workStore';
import { useSavedViewsStore, type SavedView } from '../../../stores/savedViewsStore';
import { DEFAULT_QUEUE_CONFIG, DEFAULT_QUEUE_FILTERS } from '../queueFilters';
import { WorkQueue } from './WorkQueue';
import type { WorkQueueModel } from '../useWorkQueue';
import type { WorkTask } from '../types';

const task = (id: string, title: string) =>
  ({ id, number: 1, title, status: 'doing', boardId: 'b', boardName: 'B', activity: 'idle', since: null, lastActivityAt: null, prs: [], worktrees: [], epics: [] }) as unknown as WorkTask;

const A = task('a', 'Task A');
const B = task('b', 'Task B');

function model(over: Partial<WorkQueueModel> = {}): WorkQueueModel {
  return {
    tasks: [A, B],
    groups: [{ key: 'idle', label: 'IDLE', items: [A, B] }],
    orderedIds: [A.id, B.id],
    pinned: null,
    byId: new Map([[A.id, A], [B.id, B]]),
    boards: [],
    epics: [],
    known: { boards: null, epics: null },
    selectedTask: A,
    counts: { total: 2, running: 0, needs: 0 },
    ...over,
  };
}

const VIEW: SavedView = {
  id: 'v1',
  name: 'ODYS AI',
  emoji: '🔭',
  filters: { ...DEFAULT_QUEUE_FILTERS, boards: ['odys'] },
  display: DEFAULT_QUEUE_CONFIG.display,
  createdAt: '',
  updatedAt: '',
};

beforeEach(() => {
  useSavedViewsStore.setState({ views: [VIEW], status: 'ready', load: async () => {} });
  useWorkStore.setState({ view: 'task', queueConfig: DEFAULT_QUEUE_CONFIG, activeViewId: null, viewDrafts: {}, pinnedTicketId: null });
});
afterEach(cleanup);

describe('WorkQueue — saved views', () => {
  it('« All tasks » never shows the modified bar', () => {
    render(<WorkQueue queue={model()} onOpenExecution={() => {}} />);
    expect(screen.getByTestId('view-picker').textContent).toContain('All tasks');
    expect(screen.queryByTestId('view-dirty-bar')).toBeNull();
  });

  it('an active view whose filters were changed shows the bar; Reset clears it', () => {
    useWorkStore.setState({ activeViewId: 'v1', queueConfig: { ...DEFAULT_QUEUE_CONFIG, filters: { ...VIEW.filters, types: ['fix'] } } });
    render(<WorkQueue queue={model()} onOpenExecution={() => {}} />);
    expect(screen.getByTestId('view-picker').textContent).toContain('ODYS AI');
    const bar = screen.getByTestId('view-dirty-bar');
    fireEvent.click(within(bar).getByRole('button', { name: 'Reset' }));
    expect(useWorkStore.getState().queueConfig.filters.types).toEqual([]);
    expect(screen.queryByTestId('view-dirty-bar')).toBeNull();
  });

  it('the picker is disabled when the storage has no saved views', () => {
    useSavedViewsStore.setState({ status: 'unavailable' });
    render(<WorkQueue queue={model()} onOpenExecution={() => {}} />);
    expect((screen.getByTestId('view-picker') as HTMLButtonElement).disabled).toBe(true);
  });

  it('the pin names the new filters that hide it (AC5)', () => {
    const pinned = task('p', 'Pinned one');
    render(<WorkQueue queue={model({ pinned: { task: pinned, excludedBy: ['epics', 'prs', 'blocked', 'inactiveFor'] } })} onOpenExecution={() => {}} />);
    expect(within(screen.getByTestId('queue-pinned')).getByText('Hidden by filters: epic, PR, blocked, inactivity')).toBeTruthy();
  });

  it('renders sub-groups under their group, both foldable', () => {
    const groups = [
      {
        key: 'high',
        label: 'HIGH',
        items: [A, B],
        subgroups: [
          { key: 'high/doing', label: 'Doing', items: [A] },
          { key: 'high/reviewing', label: 'Reviewing', items: [B] },
        ],
      },
    ];
    render(<WorkQueue queue={model({ groups })} onOpenExecution={() => {}} />);
    expect(screen.getByText('Doing')).toBeTruthy();
    fireEvent.click(screen.getByText('Doing'));
    expect(screen.queryByText('Task A')).toBeNull();
    expect(screen.getByText('Task B')).toBeTruthy();
    fireEvent.click(screen.getByText('HIGH'));
    expect(screen.queryByText('Task B')).toBeNull();
  });
});

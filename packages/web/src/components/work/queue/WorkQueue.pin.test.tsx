import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useWorkStore } from '../../../stores/workStore';
import { WorkQueue } from './WorkQueue';
import type { WorkQueueModel } from '../useWorkQueue';
import type { WorkTask } from '../types';

const task = (id: string, title: string, status = 'doing') =>
  ({ id, number: 1, title, status, boardId: 'b', boardName: 'B', activity: 'idle', since: null, lastActivityAt: null, prs: [], worktrees: [] }) as unknown as WorkTask;

const QUEUED = task('q1', 'In the queue');
const PINNED = task('p1', 'Opened from the Kanban', 'todo');

function model(pinned: WorkQueueModel['pinned']): WorkQueueModel {
  return {
    tasks: [QUEUED],
    groups: [{ key: 'idle', label: 'IDLE', items: [QUEUED] }],
    orderedIds: [...(pinned ? [pinned.task.id] : []), QUEUED.id],
    pinned,
    byId: new Map([[QUEUED.id, QUEUED]]),
    boards: [],
    selectedTask: QUEUED,
    counts: { total: 1, running: 0, needs: 0 },
  };
}

beforeEach(() => useWorkStore.setState({ view: 'task', pinnedTicketId: PINNED.id, selectedTicketId: QUEUED.id }));
afterEach(cleanup);

describe('WorkQueue — pinned ticket section', () => {
  it('shows the pin on top with the filters that hide it, and × removes it', () => {
    render(<WorkQueue queue={model({ task: PINNED, excludedBy: ['boardFilters', 'statusFilters'] })} onOpenExecution={() => {}} />);
    const section = screen.getByTestId('queue-pinned');
    expect(within(section).getByText('Opened from the Kanban')).toBeTruthy();
    expect(within(section).getByText('Hidden by filters: board, status')).toBeTruthy();

    fireEvent.click(within(section).getByRole('button', { name: 'Remove from the queue' }));
    expect(useWorkStore.getState().pinnedTicketId).toBeNull();
  });

  it('selecting the pinned row selects it, the pin stays', () => {
    render(<WorkQueue queue={model({ task: PINNED, excludedBy: ['statusFilters'] })} onOpenExecution={() => {}} />);
    fireEvent.click(within(screen.getByTestId('queue-pinned')).getByText('Opened from the Kanban'));
    expect(useWorkStore.getState().selectedTicketId).toBe(PINNED.id);
    expect(useWorkStore.getState().pinnedTicketId).toBe(PINNED.id);
  });

  it('renders no section when there is no out-of-filters pin', () => {
    render(<WorkQueue queue={model(null)} onOpenExecution={() => {}} />);
    expect(screen.queryByTestId('queue-pinned')).toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';
import { useWorkStore } from '../../../stores/workStore';
import { useSavedViewsStore } from '../../../stores/savedViewsStore';
import { WorkQueue } from './WorkQueue';
import type { WorkQueueModel } from '../useWorkQueue';
import type { QueueGroup, WorkTask } from '../types';

const task = (id: string, title: string) =>
  ({ id, number: 1, title, status: 'doing', boardId: 'b', boardName: 'B', activity: 'idle', since: null, lastActivityAt: null, prs: [], worktrees: [] }) as unknown as WorkTask;

const A = task('a', 'Toggles in the sidebar');
const B = task('b', 'Rename a ticket');
const C = task('c', 'AI cost projections');

function model(groups: QueueGroup[]): WorkQueueModel {
  const tasks = groups.flatMap((g) => g.items);
  return {
    tasks,
    groups,
    orderedIds: tasks.map((t) => t.id),
    pinned: null,
    byId: new Map(tasks.map((t) => [t.id, t])),
    boards: [],
    epics: [],
    known: { boards: null, epics: null },
    selectedTask: null,
    counts: { total: tasks.length, running: 0, needs: 0 },
  } as unknown as WorkQueueModel;
}

// Board › Status: FLEEX (Doing, Reviewing), then LEADERSHIP (Doing).
const BOARD_STATUS: QueueGroup[] = [
  {
    key: 'fleex',
    label: 'FLEEX',
    items: [A, B],
    subgroups: [
      { key: 'fleex/doing', label: 'Doing', items: [A] },
      { key: 'fleex/reviewing', label: 'Reviewing', items: [B] },
    ],
  },
  { key: 'lead', label: 'LEADERSHIP', items: [C], subgroups: [{ key: 'lead/doing', label: 'Doing', items: [C] }] },
];

beforeEach(() => {
  useSavedViewsStore.setState({ views: [], status: 'ready', load: async () => {} });
  useWorkStore.setState({ view: 'task', pinnedTicketId: null, selectedTicketId: null });
});
afterEach(cleanup);

describe('WorkQueue — group headers read as headers, not tasks', () => {
  it('draws a real SVG chevron (not an 8px text glyph) on both levels', () => {
    render(<WorkQueue queue={model(BOARD_STATUS)} onOpenExecution={() => {}} />);
    const headers = [...screen.getAllByTestId('queue-group-header'), ...screen.getAllByTestId('queue-subgroup-header')];
    for (const h of headers) {
      expect(h.querySelector('svg')).not.toBeNull();
      expect(h.textContent).not.toMatch(/[▸▾]/);
    }
  });

  it('folds and unfolds a group from anywhere on its header, and aria-expanded follows', () => {
    render(<WorkQueue queue={model(BOARD_STATUS)} onOpenExecution={() => {}} />);
    const fleex = screen.getAllByTestId('queue-group-header')[0]!;
    expect(fleex.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('Toggles in the sidebar')).not.toBeNull();

    fireEvent.click(within(fleex).getByText('FLEEX'));
    expect(fleex.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Toggles in the sidebar')).toBeNull();
    // A folded group still tells how much it hides.
    expect(within(fleex).getByText('2')).toBeTruthy();

    fireEvent.click(fleex);
    expect(fleex.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByText('Toggles in the sidebar')).not.toBeNull();
  });

  it('separates every group from the previous one, but not the first from the search field', () => {
    render(<WorkQueue queue={model(BOARD_STATUS)} onOpenExecution={() => {}} />);
    const [fleex, lead] = screen.getAllByTestId('queue-group-header') as [HTMLElement, HTMLElement];
    expect(fleex.className).not.toMatch(/border-t/);
    expect(lead.className).toMatch(/border-t/);
  });

  it('marks each sub-group with a rule running to the edge', () => {
    render(<WorkQueue queue={model(BOARD_STATUS)} onOpenExecution={() => {}} />);
    expect(screen.getAllByTestId('queue-subgroup-header')).toHaveLength(3);
    expect(screen.getAllByTestId('queue-subgroup-rule')).toHaveLength(3);
  });

  it('with a single grouping level, shows only the band: no sub-header, no rule', () => {
    render(<WorkQueue queue={model([{ key: 'fleex', label: 'FLEEX', items: [A, B] }])} onOpenExecution={() => {}} />);
    expect(screen.getAllByTestId('queue-group-header')).toHaveLength(1);
    expect(screen.queryByTestId('queue-subgroup-header')).toBeNull();
    expect(screen.queryByTestId('queue-subgroup-rule')).toBeNull();
  });

  it('keeps the group tone (NEEDS YOU stays yellow) over the default label color', () => {
    render(
      <WorkQueue
        queue={model([{ key: 'needs', label: 'NEEDS YOU', tone: 'text-[var(--tint-yellow-text)]', items: [A] }])}
        onOpenExecution={() => {}}
      />,
    );
    const label = within(screen.getByTestId('queue-group-header')).getByText('NEEDS YOU');
    expect(label.className).toContain('text-[var(--tint-yellow-text)]');
    expect(label.className).not.toContain('text-[var(--theme-text-secondary)]');
  });
});

/**
 * The task queue (left column, 300px): a header with the count and a New button,
 * board filter chips, and three ordered sections — NEEDS YOU, RUNNING, IDLE.
 * Selection drives the center and right panel; it reads the joined model from
 * useWorkQueue and writes selection to workStore.
 */
import { useCallback, useEffect, useRef } from 'react';
import { cn } from '../../../lib/cn';
import { TICKET_PRIORITIES, TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import { useWorkStore, QUEUE_MIN, QUEUE_MAX, type QueueGroupBy } from '../../../stores/workStore';
import { MultiSelect } from '../../ui/MultiSelect';
import { GroupBySelect } from './GroupBySelect';
import { PriorityIndicator, PRIORITY_LABELS } from '../../tickets/PriorityIndicator';
import type { WorkQueueModel } from '../useWorkQueue';
import { QueueRow } from './QueueRow';
import { PlusIcon, SidePanelIcon } from '../../sidebar/icons';
import { HotkeyBadge } from '../../ui/HotkeyBadge';

interface Props {
  queue: WorkQueueModel;
  /** Open the execution log for a running task's SDK run (from its activity badge). */
  onOpenExecution: (executionId: string, title: string) => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const GROUP_BY_OPTIONS: { value: QueueGroupBy; label: string }[] = [
  { value: 'activity', label: 'Activity' },
  { value: 'status', label: 'Status' },
  { value: 'board', label: 'Board' },
  { value: 'repo', label: 'Repo' },
  { value: 'type', label: 'Type' },
  { value: 'priority', label: 'Priority' },
];

export function WorkQueue({ queue, onOpenExecution }: Props) {
  const selectTicket = useWorkStore((s) => s.selectTicket);
  const setView = useWorkStore((s) => s.setView);
  const boardFilters = useWorkStore((s) => s.boardFilters);
  const setBoardFilters = useWorkStore((s) => s.setBoardFilters);
  const priorityFilters = useWorkStore((s) => s.priorityFilters);
  const setPriorityFilters = useWorkStore((s) => s.setPriorityFilters);
  const statusFilters = useWorkStore((s) => s.statusFilters);
  const setStatusFilters = useWorkStore((s) => s.setStatusFilters);
  const groupBy = useWorkStore((s) => s.groupBy);
  const setGroupBy = useWorkStore((s) => s.setGroupBy);
  const favoriteOnly = useWorkStore((s) => s.favoriteOnly);
  const setFavoriteOnly = useWorkStore((s) => s.setFavoriteOnly);
  const search = useWorkStore((s) => s.search);
  const setSearch = useWorkStore((s) => s.setSearch);
  const width = useWorkStore((s) => s.queueWidth);
  const setQueueWidth = useWorkStore((s) => s.setQueueWidth);
  const toggleQueueCollapsed = useWorkStore((s) => s.toggleQueueCollapsed);
  const view = useWorkStore((s) => s.view);
  // No queue row is "active" while composing a new task.
  const selectedId = view === 'task' ? (queue.selectedTask?.id ?? null) : null;

  const asideRef = useRef<HTMLElement>(null);
  const dragging = useRef(false);

  const onResizeDown = useCallback(() => {
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragging.current || !asideRef.current) return;
      const left = asideRef.current.getBoundingClientRect().left;
      setQueueWidth(e.clientX - left);
    }
    function onUp() {
      if (!dragging.current) return;
      dragging.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    }
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [setQueueWidth]);

  const effectiveWidth = Math.min(QUEUE_MAX, Math.max(QUEUE_MIN, width));

  return (
    <aside
      ref={asideRef}
      className="relative flex shrink-0 flex-col border-r border-[var(--theme-border)] bg-[var(--theme-bg-surface)]"
      style={{ width: effectiveWidth }}
    >
      {/* Resize handle on the right edge */}
      <div
        onMouseDown={onResizeDown}
        className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-[var(--theme-accent-muted)]"
        title="Drag to resize"
      />
      {/* Header — same title treatment as the app's other sidebars (SidebarHeader) */}
      <div
        className="flex shrink-0 items-center justify-between border-b border-[var(--theme-border)] px-3"
        style={{ height: 'var(--header-height)' }}
      >
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Tasks <span className="text-[var(--theme-text-faint)]">{queue.counts.total}</span>
        </span>
        <button
          type="button"
          onClick={toggleQueueCollapsed}
          title="Collapse tasks"
          className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
        >
          <SidePanelIcon size={14} />
        </button>
      </div>

      {/* Filters: board multi-select · priority multi-select · favorite toggle · search */}
      <div className="flex flex-col gap-1.5 px-3 pb-2 pt-2">
        <div className="flex flex-wrap items-center gap-1">
          <MultiSelect
            label="Boards"
            allLabel="All boards"
            values={boardFilters}
            onChange={setBoardFilters}
            options={queue.boards.map((b) => ({ value: b.id, label: b.name, icon: <span>{b.emoji}</span> }))}
            searchPlaceholder="Filter boards…"
          />
          <MultiSelect
            label="Priority"
            allLabel="Any priority"
            values={priorityFilters}
            onChange={setPriorityFilters}
            searchable={false}
            options={[...TICKET_PRIORITIES].map((p) => ({
              value: p,
              label: PRIORITY_LABELS[p],
              icon: <PriorityIndicator priority={p} />,
            }))}
          />
          <MultiSelect
            label="Status"
            allLabel="Any status"
            values={statusFilters}
            onChange={setStatusFilters}
            searchable={false}
            options={[...TICKET_STATUSES].map((s) => ({ value: s, label: TICKET_STATUS_LABELS[s] ?? cap(s) }))}
          />
          <button
            type="button"
            onClick={() => setFavoriteOnly(!favoriteOnly)}
            title="Show favorites only"
            className={cn(
              'rounded-md p-1 transition-colors',
              favoriteOnly
                ? 'bg-[var(--theme-accent-muted)] text-[var(--tint-yellow-text)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={favoriteOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
          </button>
          <GroupBySelect value={groupBy} onChange={setGroupBy} options={GROUP_BY_OPTIONS} />
        </div>
        <div className="relative flex items-center">
          <svg className="absolute left-2 text-[var(--theme-text-faint)]" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="7" cy="7" r="5" />
            <line x1="10.5" y1="10.5" x2="14" y2="14" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="h-7 w-full rounded-md border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] pl-7 pr-2 text-[11px] text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)]"
              title="Clear"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Sections */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'new' && (
          <div className="mx-2.5 mt-2 rounded-lg border border-dashed border-[var(--theme-accent)] px-2.5 py-2 text-[11px] text-[var(--theme-accent)]">
            New task · draft · not yet a ticket
          </div>
        )}
        {queue.groups.map((g) => (
          <div key={g.key} className="pb-1">
            <div className="flex items-center gap-1.5 px-3 pb-1 pt-2">
              <span className={cn('text-[10.5px] font-semibold tracking-[0.06em]', g.tone ?? 'text-[var(--theme-text-muted)]')}>
                {g.label}
              </span>
              <span className="text-[10.5px] text-[var(--theme-text-faint)]">{g.items.length}</span>
            </div>
            {g.items.map((task) => (
              <QueueRow
                key={task.id}
                task={task}
                selected={task.id === selectedId}
                onSelect={() => selectTicket(task.id)}
                onOpenExecution={onOpenExecution}
              />
            ))}
          </div>
        ))}

        {/* Carries on where the list stops, on a task row's own template (browser
            tab strips do this): close enough to the last task to be seen, quiet
            enough not to compete with it. It scrolls with the list — ⌥N is the
            way in from anywhere. */}
        <button
          type="button"
          onClick={() => setView('new')}
          title="New task (⌥N)"
          className="flex w-full cursor-pointer items-center gap-1.5 border-l-2 border-transparent px-2.5 py-2 text-left text-[13px] text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-accent)]"
        >
          {/* Sits in the row's picto column, so the label lines up with task titles. */}
          <span className="flex w-[26px] shrink-0 items-center justify-center">
            <PlusIcon size={14} />
          </span>
          New Task
          <HotkeyBadge hotkey="⌥N" position="inline" />
        </button>

        {queue.counts.total === 0 && (
          <div className="px-3 pb-8 pt-2 text-center text-[12px] text-[var(--theme-text-faint)]">
            No tasks match. Adjust the filters above.
          </div>
        )}
      </div>

    </aside>
  );
}

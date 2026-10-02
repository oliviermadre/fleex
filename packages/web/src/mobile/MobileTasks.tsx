import { useCallback, useMemo, useState } from 'react';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import type { TicketPriority, TicketStatus } from '@fleex/shared';
import type { WorkTask } from '../components/work/types';
import { useWorkQueue } from '../components/work/useWorkQueue';
import { useWorkStore, type QueueGroupBy } from '../stores/workStore';
import { QuickAddFab } from './MobileQuickAdd';
import { MobileNewTask } from './MobileNewTask';
import { TasksIcon } from '../components/sidebar/icons';
import { PRIORITY_LABELS } from '../components/tickets/PriorityIndicator';
import { formatAge } from '../lib/formatAge';
import { useClock } from './useClock';
import { cn } from '../lib/cn';
import { tintClasses } from '../lib/tints';
import { PRIORITY_COLOR } from './MobileTicketCard';
import { MobileSheet, SheetOption } from './MobileSheet';
import { useMobileNavStore } from './mobileNavStore';

const PRIORITIES = ['high', 'medium', 'low', 'none'] as const;
const GROUP_LABELS: Record<QueueGroupBy, string> = {
  activity: 'Activity',
  repo: 'Repo',
  type: 'Type',
  priority: 'Priority',
  board: 'Board',
  status: 'Status',
};

type SheetKind = 'boards' | 'priority' | 'status' | 'group' | 'new' | null;

/** Mobile Tasks — the desktop Work queue (same `useWorkQueue`, same filters). */
export function MobileTasks() {
  const { groups, boards, counts } = useWorkQueue();
  const openTicket = useMobileNavStore((s) => s.openTicket);
  const now = useClock();

  const boardFilters = useWorkStore((s) => s.boardFilters);
  const priorityFilters = useWorkStore((s) => s.priorityFilters);
  const statusFilters = useWorkStore((s) => s.statusFilters);
  const groupBy = useWorkStore((s) => s.groupBy);
  const favoriteOnly = useWorkStore((s) => s.favoriteOnly);
  const search = useWorkStore((s) => s.search);
  const { setBoardFilters, setPriorityFilters, setStatusFilters, setGroupBy, setFavoriteOnly, setSearch } =
    useWorkStore.getState();

  const [sheet, setSheet] = useState<SheetKind>(null);
  const closeNew = useCallback(() => setSheet(null), []);
  const sortedBoards = useMemo(() => [...boards].sort((a, b) => a.name.localeCompare(b.name)), [boards]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex shrink-0 flex-col gap-2 border-b border-[var(--theme-border)] px-4 pb-2.5 pt-1.5">
        <div className="flex items-center gap-2">
          <TasksIcon size={22} className="text-[var(--theme-accent)]" />
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <span className="text-[15px] tabular-nums text-[var(--theme-text-faint)]">{counts.total}</span>
        </div>
        <div className="relative">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--theme-text-faint)]"
            aria-hidden
          >
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="h-[38px] w-full rounded-[10px] border border-[var(--theme-border-input)] bg-[var(--theme-bg-base)] pl-8 pr-3 text-base text-[var(--theme-text-primary)] placeholder:text-[var(--theme-text-faint)] focus:border-[var(--theme-accent)] focus:outline-none"
          />
        </div>
      </header>

      <nav className="flex shrink-0 gap-1.5 overflow-x-auto px-3 py-2 [scrollbar-width:none]">
        <FilterChip active={boardFilters.length > 0} onClick={() => setSheet('boards')}>
          Boards{boardFilters.length > 0 && ` ${boardFilters.length}`} ▾
        </FilterChip>
        <FilterChip active={priorityFilters.length > 0} onClick={() => setSheet('priority')}>
          Priority{priorityFilters.length > 0 && ` ${priorityFilters.length}`} ▾
        </FilterChip>
        <FilterChip active onClick={() => setSheet('status')}>
          Status {statusFilters.length === 0 ? 'all' : statusFilters.length} ▾
        </FilterChip>
        <button
          type="button"
          aria-pressed={favoriteOnly}
          aria-label="Favoris"
          onClick={() => setFavoriteOnly(!favoriteOnly)}
          className={cn(
            'min-h-9 shrink-0 rounded-full px-3 py-1.5 text-xs font-medium',
            favoriteOnly
              ? cn('bg-[var(--theme-accent-muted)]', tintClasses('yellow').text)
              : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]',
          )}
        >
          ★
        </button>
        <FilterChip active={false} onClick={() => setSheet('group')}>
          Group: {GROUP_LABELS[groupBy]} ▾
        </FilterChip>
      </nav>

      <div
        className="min-h-0 flex-1 overflow-y-auto"
        style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 120px)' }}
      >
        {groups.length === 0 && (
          <p className="py-12 text-center text-sm text-[var(--theme-text-faint)]">Aucune tâche pour ces filtres</p>
        )}
        {groups.map((g) => (
          <section key={g.key}>
            <h2 className="flex items-center gap-1.5 px-4 pb-1 pt-3 text-[10.5px] font-semibold tracking-[0.06em]">
              <span className={g.tone ?? 'text-[var(--theme-text-muted)]'}>{g.label}</span>
              <span className="text-[var(--theme-text-faint)]">{g.items.length}</span>
            </h2>
            {g.items.map((t) => (
              <TaskRow key={t.id} task={t} now={now} onOpen={() => openTicket(t.id)} />
            ))}
          </section>
        ))}
      </div>

      {sheet === 'boards' && (
        <MobileSheet title="Boards" onClose={() => setSheet(null)}>
          {sortedBoards.map((b) => (
            <SheetOption
              key={b.id}
              label={`${b.emoji ?? ''} ${b.name}`}
              active={boardFilters.includes(b.id)}
              onClick={() => setBoardFilters(toggle(boardFilters, b.id))}
            />
          ))}
        </MobileSheet>
      )}
      {sheet === 'priority' && (
        <MobileSheet title="Priority" onClose={() => setSheet(null)}>
          {PRIORITIES.map((p) => (
            <SheetOption
              key={p}
              label={PRIORITY_LABELS[p]}
              active={priorityFilters.includes(p)}
              onClick={() => setPriorityFilters(toggle(priorityFilters, p))}
            />
          ))}
        </MobileSheet>
      )}
      {sheet === 'status' && (
        <MobileSheet title="Status" onClose={() => setSheet(null)}>
          {(TICKET_STATUSES as readonly TicketStatus[]).map((s) => (
            <SheetOption
              key={s}
              label={TICKET_STATUS_LABELS[s]}
              active={statusFilters.includes(s)}
              onClick={() => setStatusFilters(toggle(statusFilters, s))}
            />
          ))}
        </MobileSheet>
      )}
      {sheet === 'group' && (
        <MobileSheet title="Group by" onClose={() => setSheet(null)}>
          {(Object.keys(GROUP_LABELS) as QueueGroupBy[]).map((g) => (
            <SheetOption
              key={g}
              label={GROUP_LABELS[g]}
              active={groupBy === g}
              onClick={() => {
                setGroupBy(g);
                setSheet(null);
              }}
            />
          ))}
        </MobileSheet>
      )}
      {sheet !== 'new' && <QuickAddFab onClick={() => setSheet('new')} />}
      {sheet === 'new' && <MobileNewTask onClose={closeNew} />}
    </div>
  );
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function FilterChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'min-h-9 shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-medium',
        active ? 'bg-[var(--theme-bg-overlay)] text-[var(--theme-text-primary)]' : 'bg-[var(--theme-bg-secondary)] text-[var(--theme-text-muted)]',
      )}
    >
      {children}
    </button>
  );
}

function TaskRow({ task, now, onOpen }: { task: WorkTask; now: number; onOpen: () => void }) {
  const waiting = task.activity === 'waiting';
  const running = task.activity === 'running';
  const ageSrc = task.activity === 'idle' ? task.lastActivityAt : task.since;
  const age = ageSrc ? formatAge(new Date(ageSrc).toISOString(), now) : null;
  const activityTone = waiting
    ? tintClasses('yellow').text
    : running
      ? 'text-[var(--theme-accent)]'
      : 'text-[var(--theme-text-faint)]';

  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex min-h-14 w-full flex-col gap-0.5 border-b border-l-2 border-b-[var(--theme-border-subtle)] border-l-transparent px-4 py-2.5 text-left active:bg-[var(--theme-bg-hover)]"
    >
      <span className="flex items-center gap-2">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', PRIORITY_COLOR[task.priority as TicketPriority])} />
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--theme-text-primary)]">{task.title}</span>
        {task.blocked && <span className={cn('shrink-0 text-xs', tintClasses('red').text)}>🔒</span>}
        {task.favorite && <span className={cn('shrink-0 text-xs', tintClasses('yellow').text)}>★</span>}
        <span className={cn('shrink-0 font-mono text-[11px]', activityTone)}>
          {age ?? task.activity}
        </span>
      </span>
      <span className="flex items-center gap-2 pl-4 text-[11px]">
        <span className="font-mono text-[var(--theme-text-faint)]">#{task.number}</span>
        {task.activityDetail && (
          <span className={cn('min-w-0 truncate', waiting ? tintClasses('yellow').text : 'text-[var(--theme-text-muted)]')}>
            {task.activityDetail}
          </span>
        )}
        <span className="flex-1" />
        {task.boardName && <span className="whitespace-nowrap text-[var(--theme-text-faint)]">{task.boardName}</span>}
      </span>
      {running && (
        <span className="ml-4 mt-1 block h-[3px] overflow-hidden rounded-full bg-[var(--theme-border)]">
          <span
            className={cn(
              'block h-full bg-[var(--theme-accent)]',
              task.progress == null && 'work-progress-indeterminate w-1/3',
            )}
            style={task.progress != null ? { width: `${Math.round(task.progress * 100)}%` } : undefined}
          />
        </span>
      )}
    </button>
  );
}

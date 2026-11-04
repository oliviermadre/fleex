/**
 * The task queue (left column, 300px): a header with the count and a New button,
 * board filter chips, and three ordered sections — NEEDS YOU, RUNNING, IDLE.
 * Selection drives the center and right panel; it reads the joined model from
 * useWorkQueue and writes selection to workStore.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../../lib/cn';
import { TICKET_STATUSES, TICKET_STATUS_LABELS } from '@fleex/shared';
import { useWorkStore, QUEUE_MIN, QUEUE_MAX } from '../../../stores/workStore';
import { useSavedViewsStore, type SavedView } from '../../../stores/savedViewsStore';
import { useRepositoryStore } from '../../../stores/repositoryStore';
import { tintClasses } from '../../../lib/tints';
import { Tooltip } from '../../ui/Tooltip';
import { MultiSelect } from '../../ui/MultiSelect';
import { Button } from '../../ui/Button';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { QueueFiltersPopover } from './QueueFiltersPopover';
import { QueueDisplayPopover, GROUP_BY_OPTIONS } from './QueueDisplayPopover';
import { ViewPicker } from './ViewPicker';
import { ChevronDownIcon } from '../../ui/icons/TodoIcons';
import { ViewNameModal } from './ViewNameModal';
import {
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
import { popoverFilterCount, repoKey, type QueueConfig, type QueueFilterKey } from '../queueFilters';
import type { WorkQueueModel } from '../useWorkQueue';
import type { QueueGroup } from '../types';
import { QueueRow } from './QueueRow';
import { PlusIcon, SidePanelIcon } from '../../sidebar/icons';
import { HotkeyBadge } from '../../ui/HotkeyBadge';

interface Props {
  queue: WorkQueueModel;
  /** Open the execution log for a running task's SDK run (from its activity badge). */
  onOpenExecution: (executionId: string, title: string) => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** How the pinned row names the filters that exclude it. */
export const FILTER_LABELS: Record<QueueFilterKey, string> = {
  boards: 'board',
  statuses: 'status',
  priorities: 'priority',
  complexity: 'complexity',
  types: 'type',
  epics: 'epic',
  repos: 'repo',
  prs: 'PR',
  blocked: 'blocked',
  inactiveFor: 'inactivity',
  favoriteOnly: 'favorites',
  search: 'search',
};
const PIN = tintClasses('purple');

/** One line describing a config, for the « New view » recap. */
function describeConfig(config: QueueConfig, queue: WorkQueueModel): string {
  const f = config.filters;
  const parts: string[] = [];
  if (f.boards.length > 0) {
    parts.push(f.boards.map((id) => queue.boards.find((b) => b.id === id)?.name).filter(Boolean).join(' + '));
  } else parts.push('All boards');
  parts.push(f.statuses.length > 0 ? f.statuses.map((st) => TICKET_STATUS_LABELS[st] ?? cap(st)).join(', ') : 'any status');
  const n = popoverFilterCount(f) + (f.favoriteOnly ? 1 : 0);
  if (n > 0) parts.push(`${n} more filter${n > 1 ? 's' : ''}`);
  const label = (g: string | null) => GROUP_BY_OPTIONS.find((o) => o.value === g)?.label.toLowerCase();
  const d = config.display;
  parts.push(`grouped by ${label(d.groupBy)}${d.subGroupBy ? ` › ${label(d.subGroupBy)}` : ''}`);
  return parts.join(' · ');
}

type NameModal = { kind: 'create' } | { kind: 'rename'; view: SavedView } | null;

/**
 * A group header — click anywhere to fold. Two distinct signatures so the
 * hierarchy reads at a glance against the (bigger, brighter) task rows:
 * - level 1 is a band: tinted full-width strip, rule above (except the first
 *   group), count pill pushed right;
 * - level 2 is an underlined subheading: 12px label, then a hairline running to
 *   the right edge — the ornament that says "header, not task".
 */
function GroupHeader({
  group,
  nested,
  first,
  collapsed,
  onToggle,
}: {
  group: QueueGroup;
  nested?: boolean;
  first?: boolean;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={!collapsed}
      data-testid={nested ? 'queue-subgroup-header' : 'queue-group-header'}
      className={cn(
        'group/header flex w-full items-center gap-1.5 pr-3 text-left',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--theme-accent)]',
        nested
          ? cn('pl-5 py-1 hover:bg-[var(--theme-bg-hover)]', !first && 'mt-1')
          : cn(
              'min-h-[28px] pl-2.5 py-1.5 bg-[var(--theme-bg-base)] hover:bg-[var(--theme-bg-hover)]',
              !first && 'mt-2 border-t border-[var(--theme-border)]',
            ),
      )}
    >
      <span className="flex w-4 shrink-0 items-center justify-center text-[var(--theme-text-muted)] group-hover/header:text-[var(--theme-text-secondary)]">
        <ChevronDownIcon
          size={nested ? 12 : 14}
          className={cn('transition-transform duration-150', collapsed && '-rotate-90')}
        />
      </span>
      <span
        className={cn(
          'truncate font-semibold',
          nested ? 'text-[12px]' : 'text-[11px] uppercase tracking-[0.06em]',
          group.tone ?? 'text-[var(--theme-text-secondary)]',
        )}
      >
        {group.label}
      </span>
      {nested ? (
        <>
          <span className="shrink-0 text-[10.5px] text-[var(--theme-text-faint)]">{group.items.length}</span>
          <span aria-hidden="true" data-testid="queue-subgroup-rule" className="ml-2 h-px flex-1 bg-[var(--theme-border)]" />
        </>
      ) : (
        <span className="ml-auto shrink-0 rounded-full bg-[var(--theme-bg-overlay)] px-1.5 text-[10.5px] leading-[17px] text-[var(--theme-text-muted)]">
          {group.items.length}
        </span>
      )}
    </button>
  );
}

export function WorkQueue({ queue, onOpenExecution }: Props) {
  const selectTicket = useWorkStore((s) => s.selectTicket);
  const setView = useWorkStore((s) => s.setView);
  const queueConfig = useWorkStore((s) => s.queueConfig);
  const { filters, display } = queueConfig;
  const setQueueFilters = useWorkStore((s) => s.setQueueFilters);
  const setQueueDisplay = useWorkStore((s) => s.setQueueDisplay);
  const setGroupBy = useWorkStore((s) => s.setGroupBy);
  const activeViewId = useWorkStore((s) => s.activeViewId);
  const views = useSavedViewsStore((s) => s.views);
  const viewsStatus = useSavedViewsStore((s) => s.status);
  const loadViews = useSavedViewsStore((s) => s.load);
  const repositories = useRepositoryStore((s) => s.repositories);
  const search = useWorkStore((s) => s.search);
  const setSearch = useWorkStore((s) => s.setSearch);
  const width = useWorkStore((s) => s.queueWidth);
  const setQueueWidth = useWorkStore((s) => s.setQueueWidth);
  const toggleQueueCollapsed = useWorkStore((s) => s.toggleQueueCollapsed);
  const unpinTicket = useWorkStore((s) => s.unpinTicket);
  const view = useWorkStore((s) => s.view);
  // No queue row is "active" while composing a new task.
  const selectedId = view === 'task' ? (queue.selectedTask?.id ?? null) : null;

  // Saved views: read on mount and when the window regains focus (another
  // browser may have changed them); a vanished active view hands over to « All tasks ».
  useEffect(() => {
    const refresh = () => void loadViews().then(reconcileActiveView);
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [loadViews]);

  const activeView = activeViewId ? views.find((v) => v.id === activeViewId) ?? null : null;
  const dirty = isViewDirty(activeView, queueConfig, queue.known);
  const [savingView, setSavingView] = useState(false);
  const [nameModal, setNameModal] = useState<NameModal>(null);
  const [deleting, setDeleting] = useState<SavedView | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const toggleCollapsed = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const repoOptions = useMemo(
    () =>
      [...repositories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({ value: repoKey(`${r.org}/${r.name}`), label: r.name })),
    [repositories],
  );

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

      {/* Saved view picker */}
      <div className="flex items-center gap-1 px-2 pt-2">
        <ViewPicker
          views={views}
          status={viewsStatus}
          active={activeView}
          dirty={dirty}
          onSwitch={switchView}
          onNew={() => setNameModal({ kind: 'create' })}
          onRename={(view) => setNameModal({ kind: 'rename', view })}
          onDuplicate={(view) => void duplicateView(view.id)}
          onDelete={setDeleting}
          onRetry={() => void loadViews()}
        />
      </div>

      {/* Filters: boards · status · more filters · display · favorites · search */}
      <div className="flex flex-col gap-1.5 px-3 pb-2 pt-1.5">
        <div className="flex flex-wrap items-center gap-1">
          <MultiSelect
            label="Boards"
            allLabel="All boards"
            values={filters.boards}
            onChange={(boards) => setQueueFilters({ boards })}
            options={queue.boards.map((b) => ({ value: b.id, label: b.name, icon: <span>{b.emoji}</span> }))}
            searchPlaceholder="Filter boards…"
          />
          <MultiSelect
            label="Status"
            allLabel="Any status"
            values={filters.statuses}
            onChange={(statuses) => setQueueFilters({ statuses })}
            searchable={false}
            options={[...TICKET_STATUSES].map((st) => ({ value: st, label: TICKET_STATUS_LABELS[st] ?? cap(st) }))}
          />
          <QueueFiltersPopover filters={filters} onChange={setQueueFilters} epics={queue.epics} repos={repoOptions} />
          <QueueDisplayPopover display={display} onChangeGroupBy={setGroupBy} onChange={setQueueDisplay} />
          <button
            type="button"
            onClick={() => setQueueFilters({ favoriteOnly: !filters.favoriteOnly })}
            title="Show favorites only"
            className={cn(
              'rounded-md p-1 transition-colors',
              filters.favoriteOnly
                ? 'bg-[var(--theme-accent-muted)] text-[var(--tint-yellow-text)]'
                : 'text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)]',
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill={filters.favoriteOnly ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" />
            </svg>
          </button>
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

      {/* The active view's filters differ from what's saved: keep, fork or drop. */}
      {dirty && activeView && (
        <div
          data-testid="view-dirty-bar"
          className="mx-2 mb-2 flex flex-wrap items-center gap-1 rounded-md border border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] px-2 py-1"
        >
          <span className="mr-auto flex items-center gap-1.5 text-[11px] font-semibold text-[var(--theme-accent)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--theme-accent)]" />
            Modified
          </span>
          <Button
            variant="primary"
            size="sm"
            disabled={savingView}
            onClick={() => {
              setSavingView(true);
              void saveActiveView(queue.known).finally(() => setSavingView(false));
            }}
          >
            Save
          </Button>
          <Button size="sm" onClick={() => setNameModal({ kind: 'create' })}>
            New view…
          </Button>
          <Button variant="ghost" size="sm" onClick={resetActiveView}>
            Reset
          </Button>
        </div>
      )}

      {/* Sections */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {view === 'new' && (
          <div className="mx-2.5 mt-2 rounded-lg border border-dashed border-[var(--theme-accent)] px-2.5 py-2 text-[11px] text-[var(--theme-accent)]">
            New task · draft · not yet a ticket
          </div>
        )}
        {/* The ticket opened from outside the queue, kept on top while the filters
            exclude it — without ever touching the filters. Not counted. */}
        {queue.pinned && (
          <div
            data-testid="queue-pinned"
            className={cn('mx-2 mb-1 mt-2 overflow-hidden rounded-md border border-dashed', PIN.borderColor, PIN.bg)}
          >
            <div className="flex items-center gap-1.5 pl-2.5 pr-1 pt-1">
              <span className={cn('text-[10.5px] font-semibold tracking-[0.06em]', PIN.text)}>📌 OPENED OUTSIDE FILTERS</span>
              <Tooltip label="Remove from the queue">
                <button
                  type="button"
                  onClick={unpinTicket}
                  aria-label="Remove from the queue"
                  className={cn(
                    'ml-auto flex h-5 w-5 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:text-[var(--theme-text-primary)]',
                    PIN.hoverBg,
                  )}
                >
                  ✕
                </button>
              </Tooltip>
            </div>
            <QueueRow
              task={queue.pinned.task}
              selected={queue.pinned.task.id === selectedId}
              onSelect={() => selectTicket(queue.pinned!.task.id)}
              onOpenExecution={onOpenExecution}
              hiddenBy={queue.pinned.excludedBy.map((k) => FILTER_LABELS[k])}
            />
          </div>
        )}

        {queue.groups.map((g, gi) => (
          <div key={g.key} className="pb-1">
            <GroupHeader group={g} first={gi === 0} collapsed={collapsed.has(g.key)} onToggle={() => toggleCollapsed(g.key)} />
            {!collapsed.has(g.key) &&
              (g.subgroups ?? [{ ...g, key: '' }]).map((sub, si) => (
                <div key={sub.key || g.key}>
                  {sub.key && (
                    <GroupHeader
                      group={sub}
                      nested
                      first={si === 0}
                      collapsed={collapsed.has(sub.key)}
                      onToggle={() => toggleCollapsed(sub.key)}
                    />
                  )}
                  {!collapsed.has(sub.key) &&
                    sub.items.map((task) => (
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

        {queue.counts.total === 0 && !queue.pinned && (
          <div className="px-3 pb-8 pt-2 text-center text-[12px] text-[var(--theme-text-faint)]">
            No tasks match. Adjust the filters above.
          </div>
        )}
      </div>

      <ViewNameModal
        open={nameModal !== null}
        title={nameModal?.kind === 'rename' ? 'Rename view' : 'New view'}
        confirmLabel={nameModal?.kind === 'rename' ? 'Rename' : 'Create view'}
        initial={nameModal?.kind === 'rename' ? { name: nameModal.view.name, emoji: nameModal.view.emoji } : undefined}
        exceptId={nameModal?.kind === 'rename' ? nameModal.view.id : undefined}
        views={views}
        summary={nameModal?.kind === 'create' ? describeConfig(queueConfig, queue) : undefined}
        onConfirm={(name, emoji) =>
          nameModal?.kind === 'rename' ? renameView(nameModal.view.id, name, emoji) : createView(name, emoji, queue.known)
        }
        onClose={() => setNameModal(null)}
      />
      <ConfirmModal
        open={deleting !== null}
        title={`Delete "${deleting?.name ?? ''}"?`}
        message="Tickets are not touched. You can undo from the notification."
        confirmLabel="Delete"
        onConfirm={() => {
          const view = deleting;
          setDeleting(null);
          if (view) void deleteView(view.id);
        }}
        onCancel={() => setDeleting(null)}
      />
    </aside>
  );
}

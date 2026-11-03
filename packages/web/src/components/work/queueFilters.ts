/**
 * The Work queue's filter / sort / group engine — pure, no store, no React.
 *
 * A queue configuration is what a saved view stores: `filters` (which tasks show)
 * and `display` (how they are grouped and sorted). The free-text search is never
 * part of it — it is ephemeral and stays in workStore.
 *
 * Semantics: AND between filters, OR between the values of one filter. An empty
 * array means "no filter". `'none'` is the "has no value" option (no type, no
 * epic, no repo, no PR): a task without a value passes a non-empty filter only
 * when that filter holds `'none'`.
 */
import { TICKET_PRIORITY_RANK } from '@fleex/shared';
import type { WorkPrState } from './types';

export const NONE = 'none';
export type None = typeof NONE;

export type BlockedFilter = 'any' | 'blocked' | 'not_blocked';
export type PrFilterValue = None | WorkPrState;
export type InactiveFor = '1d' | '3d' | '7d' | '14d' | '30d';

export const INACTIVE_FOR_OPTIONS: readonly InactiveFor[] = ['1d', '3d', '7d', '14d', '30d'];
const INACTIVE_DAYS: Record<InactiveFor, number> = { '1d': 1, '3d': 3, '7d': 7, '14d': 14, '30d': 30 };
const DAY_MS = 24 * 60 * 60 * 1000;

export interface QueueFilters {
  /** Board ids. */
  boards: string[];
  statuses: string[];
  priorities: string[];
  /** Ticket types, or 'none' (no type). */
  types: string[];
  /** Epic (ticket_group) ids, or 'none' (in no epic). */
  epics: string[];
  /** Repo keys "org/name" lower-cased (see repoKey), or 'none' (no repo attached). */
  repos: string[];
  /** PR states — a task matches when any of its PRs is in one; 'none' = no PR link. */
  prs: PrFilterValue[];
  blocked: BlockedFilter;
  /** Only tasks whose last activity is at least this old; null = no filter. */
  inactiveFor: InactiveFor | null;
  favoriteOnly: boolean;
}

/** How the queue groups its rows. 'activity' is the handoff default. */
export type QueueGroupBy = 'activity' | 'status' | 'board' | 'epic' | 'repo' | 'type' | 'priority';
export type QueueSortKey = 'default' | 'lastActivity' | 'priority' | 'created' | 'number' | 'title';
export type SortDir = 'asc' | 'desc';
export interface QueueSort {
  key: QueueSortKey;
  dir: SortDir;
}

export interface QueueDisplay {
  groupBy: QueueGroupBy;
  /** Second grouping level, never equal to groupBy; null = none. */
  subGroupBy: QueueGroupBy | null;
  sort: QueueSort;
}

/** Everything a saved view stores. */
export interface QueueConfig {
  filters: QueueFilters;
  display: QueueDisplay;
}

export const DEFAULT_QUEUE_FILTERS: QueueFilters = {
  boards: [],
  // The handoff default: the queue shows what is in flight.
  statuses: ['doing', 'reviewing'],
  priorities: [],
  types: [],
  epics: [],
  repos: [],
  prs: [],
  blocked: 'any',
  inactiveFor: null,
  favoriteOnly: false,
};

export const DEFAULT_QUEUE_DISPLAY: QueueDisplay = {
  groupBy: 'activity',
  subGroupBy: null,
  sort: { key: 'default', dir: 'desc' },
};

export const DEFAULT_QUEUE_CONFIG: QueueConfig = { filters: DEFAULT_QUEUE_FILTERS, display: DEFAULT_QUEUE_DISPLAY };

/** The filters of the "Filters" popover (Boards and Status stay inline). */
export const POPOVER_FILTER_KEYS = ['priorities', 'types', 'epics', 'repos', 'prs', 'blocked', 'inactiveFor'] as const;

/** The filters a hidden task can be excluded by, in display order. */
export type QueueFilterKey =
  | 'boards'
  | 'statuses'
  | 'priorities'
  | 'types'
  | 'epics'
  | 'repos'
  | 'prs'
  | 'blocked'
  | 'inactiveFor'
  | 'favoriteOnly'
  | 'search';

/** The fields of a task the filters look at. */
export interface FilterableTask {
  readonly boardId: string | null;
  readonly status: string;
  readonly priority: string;
  readonly type: string | null;
  readonly favorite: boolean;
  readonly blocked: boolean;
  readonly title: string;
  readonly epics: readonly { id: string }[];
  readonly worktrees: readonly { repo: string }[];
  /** One entry per linked PR; state null while GitHub hasn't answered. */
  readonly prs: readonly { state: WorkPrState | null }[];
  /** Epoch ms of the last activity (falls back to the ticket's own dates); null = unknown. */
  readonly lastActivityAt: number | null;
}

/** Values of a multi-valued field, or ['none'] when it has none. */
function orNone(values: readonly string[]): string[] {
  return values.length > 0 ? [...values] : [NONE];
}

function anyIn(values: readonly string[], wanted: readonly string[]): boolean {
  return values.some((v) => wanted.includes(v));
}

/** The task's PR values for the PR filter: its states, or ['none'] without a PR link. */
function prValues(task: FilterableTask): string[] {
  if (task.prs.length === 0) return [NONE];
  return task.prs.map((p) => p.state).filter((s): s is WorkPrState => s !== null);
}

/** A repo's filter key: "org/name", lower-cased (links and repo settings differ in case). */
export const repoKey = (repo: string): string => repo.toLowerCase();

/** The repo keys of a task (deduped). */
export function repoKeysOf(task: Pick<FilterableTask, 'worktrees'>): string[] {
  return [...new Set(task.worktrees.map((w) => repoKey(w.repo)))];
}

/**
 * The filters that exclude `task`, in display order — empty when it passes them
 * all. Drives both the queue and the « Opened outside filters » pin, which names
 * these keys; it never suggests changing the filters.
 */
export function matchQueueFilters(
  filters: QueueFilters,
  search: string,
  task: FilterableTask,
  now: number,
): QueueFilterKey[] {
  const out: QueueFilterKey[] = [];
  const f = filters;
  if (f.boards.length > 0 && !(task.boardId && f.boards.includes(task.boardId))) out.push('boards');
  if (f.statuses.length > 0 && !f.statuses.includes(task.status)) out.push('statuses');
  if (f.priorities.length > 0 && !f.priorities.includes(task.priority)) out.push('priorities');
  if (f.types.length > 0 && !f.types.includes(task.type ?? NONE)) out.push('types');
  if (f.epics.length > 0 && !anyIn(orNone(task.epics.map((e) => e.id)), f.epics)) out.push('epics');
  if (f.repos.length > 0 && !anyIn(orNone(repoKeysOf(task)), f.repos)) out.push('repos');
  if (f.prs.length > 0 && !anyIn(prValues(task), f.prs)) out.push('prs');
  if (f.blocked === 'blocked' && !task.blocked) out.push('blocked');
  if (f.blocked === 'not_blocked' && task.blocked) out.push('blocked');
  if (f.inactiveFor) {
    const cutoff = now - INACTIVE_DAYS[f.inactiveFor] * DAY_MS;
    // Unknown activity can't prove inactivity: excluded.
    if (task.lastActivityAt === null || task.lastActivityAt > cutoff) out.push('inactiveFor');
  }
  if (f.favoriteOnly && !task.favorite) out.push('favoriteOnly');
  const q = search.trim().toLowerCase();
  if (q && !task.title.toLowerCase().includes(q)) out.push('search');
  return out;
}

/** How many filters of the "Filters" popover are active (its badge). */
export function popoverFilterCount(f: QueueFilters): number {
  return POPOVER_FILTER_KEYS.filter((k) => {
    const v = f[k];
    if (Array.isArray(v)) return v.length > 0;
    if (k === 'blocked') return v !== 'any';
    return v !== null;
  }).length;
}

/** The popover's filters cleared — Boards, Status and favorites untouched. */
export function clearPopoverFilters(f: QueueFilters): QueueFilters {
  return { ...f, priorities: [], types: [], epics: [], repos: [], prs: [], blocked: 'any', inactiveFor: null };
}

/** Ids that still exist; null = not loaded yet (nothing is pruned). */
export interface KnownIds {
  boards: ReadonlySet<string> | null;
  epics: ReadonlySet<string> | null;
}

/**
 * A config without the board / epic ids that no longer exist ('none' is kept).
 * A view referencing a deleted board applies as if the id weren't there, and is
 * not shown as modified for it.
 */
export function pruneUnknown(config: QueueConfig, known: KnownIds): QueueConfig {
  const keep = (ids: string[], set: ReadonlySet<string> | null) =>
    set ? ids.filter((id) => id === NONE || set.has(id)) : ids;
  return {
    ...config,
    filters: {
      ...config.filters,
      boards: keep(config.filters.boards, known.boards),
      epics: keep(config.filters.epics, known.epics),
    },
  };
}

/**
 * Fill a config read from storage (an older shape, a hand-edited blob) with
 * defaults so every field is there, and keep subGroupBy ≠ groupBy.
 */
export function completeConfig(raw: unknown): QueueConfig {
  const r = (raw ?? {}) as { filters?: Partial<QueueFilters>; display?: Partial<QueueDisplay> };
  const filters = { ...DEFAULT_QUEUE_FILTERS, ...(r.filters ?? {}) };
  const display = { ...DEFAULT_QUEUE_DISPLAY, ...(r.display ?? {}) };
  display.sort = { ...DEFAULT_QUEUE_DISPLAY.sort, ...(r.display?.sort ?? {}) };
  if (display.subGroupBy === display.groupBy) display.subGroupBy = null;
  return { filters, display };
}

const sorted = <T extends string>(a: readonly T[]): T[] => [...a].sort();

/** Canonical form for comparison and saving: arrays sorted, unknown ids dropped. */
export function normalizeConfig(config: QueueConfig, known: KnownIds): QueueConfig {
  const c = pruneUnknown(completeConfig(config), known);
  const f = c.filters;
  return {
    filters: {
      ...f,
      boards: sorted(f.boards),
      statuses: sorted(f.statuses),
      priorities: sorted(f.priorities),
      types: sorted(f.types),
      epics: sorted(f.epics),
      repos: sorted(f.repos),
      prs: sorted(f.prs),
    },
    display: { groupBy: c.display.groupBy, subGroupBy: c.display.subGroupBy, sort: { ...c.display.sort } },
  };
}

/** Whether two configs mean the same queue (order of values and deleted ids ignored). */
export function sameConfig(a: QueueConfig, b: QueueConfig, known: KnownIds): boolean {
  return JSON.stringify(normalizeConfig(a, known)) === JSON.stringify(normalizeConfig(b, known));
}

/** Change the first grouping level; a sub-group equal to it falls back to none. */
export function withGroupBy(display: QueueDisplay, groupBy: QueueGroupBy): QueueDisplay {
  return { ...display, groupBy, subGroupBy: display.subGroupBy === groupBy ? null : display.subGroupBy };
}

// ── Sorting ───────────────────────────────────────────────────────────────────

/** The fields of a task the sorts look at. */
export interface SortableTask {
  readonly number: number | null;
  readonly title: string;
  readonly priority: string;
  readonly lastActivityAt: number | null;
  readonly createdAt: number | null;
}

/** Shared rank is most-urgent-first (urgent=0 … none=4); unknown values rank as 'none'. */
const priorityRank = (p: string): number =>
  TICKET_PRIORITY_RANK[p as keyof typeof TICKET_PRIORITY_RANK] ?? TICKET_PRIORITY_RANK.none;

/** Recency-descending: the order of every non-activity group today. */
export function byRecent(a: Pick<SortableTask, 'lastActivityAt'>, b: Pick<SortableTask, 'lastActivityAt'>): number {
  return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
}

/**
 * An explicit sort's comparator ('default' is handled by the caller — each
 * grouping keeps its own order). Ties fall back to recency.
 */
export function compareBy(sort: QueueSort): (a: SortableTask, b: SortableTask) => number {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const cmp = (a: SortableTask, b: SortableTask): number => {
    switch (sort.key) {
      case 'lastActivity':
        return (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0);
      case 'created':
        return (a.createdAt ?? 0) - (b.createdAt ?? 0);
      case 'priority':
        // Ascending = least urgent first, so invert the shared most-urgent-first rank.
        return priorityRank(b.priority) - priorityRank(a.priority);
      case 'number':
        return (a.number ?? 0) - (b.number ?? 0);
      case 'title':
        return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      default:
        return 0;
    }
  };
  return (a, b) => sign * cmp(a, b) || byRecent(a, b);
}

/** The direction a sort starts in when picked (A→Z and #1→#n read naturally ascending). */
export function defaultDirFor(key: QueueSortKey): SortDir {
  return key === 'title' || key === 'number' ? 'asc' : 'desc';
}

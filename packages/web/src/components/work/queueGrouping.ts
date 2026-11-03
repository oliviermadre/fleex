/**
 * Group (one or two levels) and sort the queue's tasks. Pure — tested in
 * queueGrouping.test.ts.
 *
 * 'activity' reuses the tested partition (NEEDS YOU / RUNNING / IDLE, each with
 * its own order); the other groupings bucket by one task field, groups ordered
 * sensibly ('none' last) and rows by recency. A task lands in exactly one group:
 * a multi-repo task in its first repo's group, a multi-epic task in its first
 * epic by name — so the display order has no duplicates.
 */
import { TICKET_PRIORITY_RANK, TICKET_STATUS_LABELS, TICKET_TYPE_LABELS } from '@fleex/shared';
import { partitionQueue, type QueueItem } from './selectors';
import { PRIORITY_LABELS } from '../tickets/PriorityIndicator';
import { byRecent, compareBy, type QueueDisplay, type QueueGroupBy, type QueueSort } from './queueFilters';
import type { QueueGroup, WorkTask } from './types';

const STATUS_ORDER = ['doing', 'reviewing', 'todo', 'backlog', 'done', 'cancelled'];
const NONE_KEY = '~none';
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Bucket {
  key: string;
  label: string;
  tone?: string;
  items: WorkTask[];
}

/** The task's first epic by name — its one epic group. */
function firstEpic(t: WorkTask): WorkTask['epics'][number] | null {
  if (t.epics.length === 0) return null;
  return [...t.epics].sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}

function keyOf(t: WorkTask, by: Exclude<QueueGroupBy, 'activity'>): { key: string; label: string } {
  switch (by) {
    case 'repo': {
      const repo = t.worktrees[0]?.repo;
      return repo ? { key: repo, label: repo } : { key: NONE_KEY, label: 'No repo' };
    }
    case 'epic': {
      const epic = firstEpic(t);
      return epic
        ? { key: epic.id, label: epic.emoji ? `${epic.emoji} ${epic.name}` : epic.name }
        : { key: NONE_KEY, label: 'No epic' };
    }
    case 'type':
      return t.type
        ? { key: t.type, label: TICKET_TYPE_LABELS[t.type] ?? cap(t.type) }
        : { key: NONE_KEY, label: 'No type' };
    case 'priority':
      return { key: t.priority, label: PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS] ?? cap(t.priority) };
    case 'board':
      return t.boardName ? { key: t.boardId ?? t.boardName, label: t.boardName } : { key: NONE_KEY, label: 'No board' };
    case 'status':
      return { key: t.status, label: TICKET_STATUS_LABELS[t.status] ?? cap(t.status) };
  }
}

function orderIndex(by: QueueGroupBy, key: string): number {
  if (by === 'priority') return TICKET_PRIORITY_RANK[key as keyof typeof TICKET_PRIORITY_RANK] ?? 99;
  const order = by === 'status' ? STATUS_ORDER : null;
  if (!order) return 0;
  const i = order.indexOf(key);
  return i === -1 ? 99 : i;
}

/**
 * Split tasks into ordered buckets. With the default sort, a top level orders
 * rows its own way (activity: per partition; others: by recency) and a sub-level
 * keeps its parent's order; an explicit sort applies inside every bucket.
 */
function bucketize(tasks: WorkTask[], by: QueueGroupBy, sort: QueueSort, nested: boolean): Bucket[] {
  const explicit = sort.key !== 'default';
  const order = (items: WorkTask[]): WorkTask[] => {
    if (explicit) return [...items].sort(compareBy(sort));
    return nested ? items : [...items].sort(byRecent);
  };

  if (by === 'activity') {
    const items: QueueItem[] = tasks.map((t) => ({
      id: t.id,
      title: t.title,
      boardId: t.boardId,
      boardName: t.boardName,
      activity: t.activity,
      since: t.since,
      lastActivityAt: t.lastActivityAt,
    }));
    const p = partitionQueue(items);
    const byId = new Map(tasks.map((t) => [t.id, t]));
    // The partition's own order is the default, at any level.
    const pick = (arr: QueueItem[]) => {
      const picked = arr.map((i) => byId.get(i.id)!).filter(Boolean);
      return explicit ? picked.sort(compareBy(sort)) : picked;
    };
    return [
      { key: 'needs', label: 'NEEDS YOU', tone: 'text-[var(--tint-yellow-text)]', items: pick(p.needs) },
      { key: 'running', label: 'RUNNING', tone: 'text-[var(--theme-accent)]', items: pick(p.running) },
      { key: 'idle', label: 'IDLE', tone: 'text-[var(--theme-text-muted)]', items: pick(p.idle) },
    ].filter((g) => g.items.length > 0);
  }

  const buckets = new Map<string, { label: string; items: WorkTask[] }>();
  for (const t of tasks) {
    const { key, label } = keyOf(t, by);
    const bucket = buckets.get(key) ?? { label, items: [] };
    bucket.items.push(t);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([ka, va], [kb, vb]) => {
      const oi = orderIndex(by, ka) - orderIndex(by, kb);
      if (oi !== 0) return oi;
      // "none" last, then alphabetical by label.
      if (ka === NONE_KEY) return 1;
      if (kb === NONE_KEY) return -1;
      return va.label.localeCompare(vb.label);
    })
    .map(([key, v]) => ({ key, label: v.label, items: order(v.items) }));
}

/**
 * Group tasks for the queue. With a sub-grouping, each group carries its
 * `subgroups` and its `items` are their rows in display order (so counts and
 * keyboard order stay the group's).
 */
export function groupTasks(tasks: WorkTask[], display: QueueDisplay): QueueGroup[] {
  const sub = display.subGroupBy && display.subGroupBy !== display.groupBy ? display.subGroupBy : null;
  return bucketize(tasks, display.groupBy, display.sort, false).map((b) => {
    const label = b.label.toUpperCase();
    if (!sub) return { key: b.key, label, tone: b.tone, items: b.items };
    const subgroups = bucketize(b.items, sub, display.sort, true).map((s) => ({
      key: `${b.key}/${s.key}`,
      label: s.label,
      tone: s.tone,
      items: s.items,
    }));
    return { key: b.key, label, tone: b.tone, items: subgroups.flatMap((s) => s.items), subgroups };
  });
}

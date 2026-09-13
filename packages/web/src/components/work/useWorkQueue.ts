/**
 * useWorkQueue — the single place that joins the real stores into the Work
 * view's model. It loads tickets/boards/activity, builds a WorkTask per ticket
 * in scope (status doing/reviewing across all boards), partitions them into the
 * three queue sections, and resolves the selected task. Every Work component
 * consumes this; none reaches into a store for queue data itself.
 */
import { useEffect, useMemo } from 'react';
import type { AgentActivityState, BoardWithCounts, TicketLink } from '@fleex/shared';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { useWorkStore, type QueueGroupBy } from '../../stores/workStore';
import { partitionQueue, type QueueItem } from './selectors';
import { PRIORITY_LABELS } from '../tickets/PriorityIndicator';
import { TICKET_TYPE_LABELS } from '@fleex/shared';
import type { WorkTask, WorkWorktree, QueueGroup } from './types';

function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Short repo name for display: "org/name" → "name". */
export function shortRepo(repo: string): string {
  const slash = repo.lastIndexOf('/');
  return slash >= 0 ? repo.slice(slash + 1) : repo;
}

/**
 * The repos attached to a ticket. Multi-repo tickets attach via `repository`
 * links (ref = "org/name", no branch); single-repo tickets may instead carry a
 * `worktree` link (ref = "org/name:branch"). We prefer the repository links (the
 * real multi-repo source) and fall back to worktree links.
 */
function reposFromLinks(links: readonly TicketLink[]): WorkWorktree[] {
  const repoLinks = links.filter((l) => l.type === 'repository');
  if (repoLinks.length > 0) {
    return repoLinks.map((l) => ({ repo: l.ref, branch: '', worktreeId: l.id }));
  }
  return links
    .filter((l) => l.type === 'worktree')
    .map((l) => {
      const colon = l.ref.indexOf(':');
      const repo = colon > 0 ? l.ref.slice(0, colon) : l.ref;
      const branch = colon > 0 ? l.ref.slice(colon + 1) : '';
      return { repo, branch, worktreeId: l.id };
    });
}

/**
 * The ticket's pull request from its `github_pr` link. The ref is normally
 * "org/name#123"; we surface it as "name#123". Additions/deletions aren't on the
 * link — they're filled from pullRequestStore when available.
 */
function prFromLinks(links: readonly TicketLink[]): { ref: string; url: string | null; linkId: string } | null {
  const pr = links.find((l) => l.type === 'github_pr');
  if (!pr) return null;
  const hash = pr.ref.indexOf('#');
  const repoPart = hash > 0 ? pr.ref.slice(0, hash) : '';
  const num = hash > 0 ? pr.ref.slice(hash) : pr.ref;
  const ref = repoPart ? `${shortRepo(repoPart)}${num}` : pr.ref;
  return { ref, url: pr.url ?? null, linkId: pr.id };
}

export interface WorkQueueModel {
  tasks: WorkTask[];
  /** Ordered, grouped rows for the current groupBy. */
  groups: QueueGroup[];
  /** Flattened display order of ids (drives ⌘⇧↑/↓). */
  orderedIds: string[];
  /** WorkTask lookup by id. */
  byId: Map<string, WorkTask>;
  boards: BoardWithCounts[];
  selectedTask: WorkTask | null;
  counts: { total: number; running: number; needs: number };
}

export function useWorkQueue(): WorkQueueModel {
  const tickets = useTicketStore((s) => s.tickets);
  const boards = useTicketStore((s) => s.boards);
  const fetchTickets = useTicketStore((s) => s.fetchTickets);
  const fetchBoards = useTicketStore((s) => s.fetchBoards);
  const fetchRepositories = useRepositoryStore((s) => s.fetchRepositories);

  const activityByTicket = useTicketActivityStore((s) => s.activityByTicket);
  const detailByTicket = useTicketActivityStore((s) => s.detailByTicket);
  const sinceByTicket = useTicketActivityStore((s) => s.sinceByTicket);
  const lastActivityAtByTicket = useTicketActivityStore((s) => s.lastActivityAtByTicket);
  const runningExecutionIdByTicket = useTicketActivityStore((s) => s.runningExecutionIdByTicket);
  const costByTicket = useTicketActivityStore((s) => s.costByTicket);
  const loadActivity = useTicketActivityStore((s) => s.loadActivity);

  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const runsByTicket = useWorkflowRunStore((s) => s.runsByTicket);

  const boardFilters = useWorkStore((s) => s.boardFilters);
  const priorityFilters = useWorkStore((s) => s.priorityFilters);
  const statusFilters = useWorkStore((s) => s.statusFilters);
  const groupBy = useWorkStore((s) => s.groupBy);
  const favoriteOnly = useWorkStore((s) => s.favoriteOnly);
  const search = useWorkStore((s) => s.search);
  const selectedTicketId = useWorkStore((s) => s.selectedTicketId);

  // Prime tickets/boards once. useTickets() may already be mounted higher up;
  // fetching again is cheap and keeps the view self-sufficient when it isn't.
  useEffect(() => {
    void fetchBoards();
    void fetchTickets();
    void fetchRepositories();
  }, [fetchBoards, fetchTickets, fetchRepositories]);

  // The tickets in queue scope = those whose status is in the status filter
  // (defaults to doing + reviewing). An empty filter shows every status.
  const statusFilterKey = statusFilters.join(',');
  const scopedTickets = useMemo(() => {
    const set = new Set(statusFilters);
    return set.size === 0 ? tickets : tickets.filter((t) => set.has(t.status));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, statusFilterKey]);
  const scopedIds = useMemo(() => scopedTickets.map((t) => t.id), [scopedTickets]);
  const scopedIdsKey = scopedIds.join(',');

  useEffect(() => {
    if (scopedIds.length > 0) void loadActivity(scopedIds);
    // scopedIdsKey collapses the array identity to a stable string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedIdsKey, loadActivity]);

  // Session count and PR diff stats per ticket come from the session groups —
  // the only place the ticket↔worktree link (and its diffStats) lives. Worktrees
  // and the PR ref itself come from the ticket's own links (below).
  const { sessionCountByTicket, diffStatsByTicket } = useMemo(() => {
    const counts = new Map<string, number>();
    const diffs = new Map<string, { additions: number; deletions: number }>();
    for (const group of sessionGroups) {
      for (const wt of group.worktrees) {
        const ticketId = wt.ticketId ?? wt.agentWorktree?.ticketId;
        if (!ticketId) continue;
        counts.set(ticketId, (counts.get(ticketId) ?? 0) + wt.sessions.length);
        if (wt.diffStats && !diffs.has(ticketId)) {
          diffs.set(ticketId, { additions: wt.diffStats.additions, deletions: wt.diffStats.deletions });
        }
      }
    }
    return { sessionCountByTicket: counts, diffStatsByTicket: diffs };
  }, [sessionGroups]);

  const boardById = useMemo(() => {
    const m = new Map<string, BoardWithCounts>();
    for (const b of boards) m.set(b.id, b);
    return m;
  }, [boards]);

  const tasks = useMemo<WorkTask[]>(() => {
    const boardSet = new Set(boardFilters);
    const prioritySet = new Set(priorityFilters);
    const q = search.trim().toLowerCase();
    const filtered = scopedTickets.filter((t) => {
      if (boardSet.size > 0 && !boardSet.has(t.boardId)) return false;
      if (prioritySet.size > 0 && !prioritySet.has(t.priority)) return false;
      if (favoriteOnly && !t.favorite) return false;
      if (q && !t.title.toLowerCase().includes(q)) return false;
      return true;
    });

    return filtered.map((t) => {
      const activity: AgentActivityState = activityByTicket[t.id] ?? 'idle';
      const worktrees = reposFromLinks(t.links);
      const activeRun = runsByTicket[t.id]?.find((r) =>
        ['running', 'blocked', 'needs_review'].includes(r.status),
      );
      let progress: number | null = null;
      if (activeRun) {
        const steps = activeRun.templateSnapshot.steps;
        const idx = steps.findIndex((s) => s.id === activeRun.currentStepId);
        if (idx >= 0 && steps.length > 0) progress = (idx + 1) / steps.length;
      }

      // PR from the ticket's github_pr link; diff stats from the PR polling
      // store, matched on the PR's worktree repo + branch when we have one.
      const prBase = prFromLinks(t.links);
      let pr: WorkTask['pr'] = null;
      if (prBase) {
        const stats = diffStatsByTicket.get(t.id);
        pr = {
          ref: prBase.ref,
          checksLabel: null,
          additions: stats?.additions ?? null,
          deletions: stats?.deletions ?? null,
          url: prBase.url ?? undefined,
        };
      }

      return {
        id: t.id,
        number: t.displayId,
        title: t.title,
        boardId: t.boardId,
        boardName: boardById.get(t.boardId)?.name ?? null,
        status: t.status,
        type: t.type,
        size: null,
        priority: t.priority,
        favorite: t.favorite,
        blocked: t.blocked,
        activity,
        activityDetail: detailByTicket[t.id] ?? null,
        since: toMs(sinceByTicket[t.id]),
        lastActivityAt: toMs(lastActivityAtByTicket[t.id]) ?? toMs(t.updatedAt),
        cost: costByTicket[t.id] ?? null,
        runningExecutionId: runningExecutionIdByTicket[t.id] ?? null,
        progress,
        worktrees,
        suggestedRepos: [],
        pr,
        deliverableCount: 0,
        sessionCount: sessionCountByTicket.get(t.id) ?? 0,
      } satisfies WorkTask;
    });
  }, [
    scopedTickets,
    boardFilters,
    priorityFilters,
    favoriteOnly,
    search,
    activityByTicket,
    detailByTicket,
    sinceByTicket,
    lastActivityAtByTicket,
    costByTicket,
    runningExecutionIdByTicket,
    sessionCountByTicket,
    diffStatsByTicket,
    runsByTicket,
    boardById,
  ]);

  const byId = useMemo(() => {
    const m = new Map<string, WorkTask>();
    for (const t of tasks) m.set(t.id, t);
    return m;
  }, [tasks]);

  const groups = useMemo<QueueGroup[]>(() => groupTasks(tasks, groupBy), [tasks, groupBy]);

  const orderedIds = useMemo(() => groups.flatMap((g) => g.items.map((t) => t.id)), [groups]);

  // Selected task: the persisted selection when still in scope, else the first
  // row in display order.
  const selectedTask = useMemo<WorkTask | null>(() => {
    if (selectedTicketId && byId.has(selectedTicketId)) return byId.get(selectedTicketId)!;
    const fallback = orderedIds[0] ?? null;
    return fallback ? byId.get(fallback) ?? null : null;
  }, [selectedTicketId, byId, orderedIds]);

  const counts = useMemo(
    () => ({
      total: tasks.length,
      running: tasks.filter((t) => t.activity === 'running').length,
      needs: tasks.filter((t) => t.activity === 'waiting').length,
    }),
    [tasks],
  );

  return { tasks, groups, orderedIds, byId, boards, selectedTask, counts };
}

/** Recency-descending sort (for non-activity groupings). */
function byRecent(a: WorkTask, b: WorkTask): number {
  return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
}

const STATUS_ORDER = ['doing', 'reviewing', 'todo', 'backlog', 'done', 'cancelled'];
const PRIORITY_ORDER = ['high', 'medium', 'low', 'none'];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Group tasks for the queue. 'activity' reuses the tested partition (NEEDS YOU /
 * RUNNING / IDLE with its tints); the others bucket by a single ticket field,
 * groups ordered sensibly and rows within a group by recency. A multi-repo task
 * lands in its first repo's group only, so display order has no duplicates.
 */
function groupTasks(tasks: WorkTask[], groupBy: QueueGroupBy): QueueGroup[] {
  if (groupBy === 'activity') {
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
    const pick = (arr: QueueItem[]) => arr.map((i) => byId.get(i.id)!).filter(Boolean);
    return [
      { key: 'needs', label: 'NEEDS YOU', tone: 'text-[var(--tint-yellow-text)]', items: pick(p.needs) },
      { key: 'running', label: 'RUNNING', tone: 'text-[var(--theme-accent)]', items: pick(p.running) },
      { key: 'idle', label: 'IDLE', tone: 'text-[var(--theme-text-muted)]', items: pick(p.idle) },
    ].filter((g) => g.items.length > 0);
  }

  // Bucket by a single field.
  const buckets = new Map<string, { label: string; items: WorkTask[] }>();
  const keyOf = (t: WorkTask): { key: string; label: string } => {
    switch (groupBy) {
      case 'repo': {
        const repo = t.worktrees[0]?.repo;
        return repo ? { key: repo, label: repo } : { key: '~none', label: 'No repo' };
      }
      case 'type':
        return t.type
          ? { key: t.type, label: TICKET_TYPE_LABELS[t.type as keyof typeof TICKET_TYPE_LABELS] ?? cap(t.type) }
          : { key: '~none', label: 'No type' };
      case 'priority':
        return { key: t.priority, label: PRIORITY_LABELS[t.priority as keyof typeof PRIORITY_LABELS] ?? cap(t.priority) };
      case 'board':
        return t.boardName ? { key: t.boardId ?? t.boardName, label: t.boardName } : { key: '~none', label: 'No board' };
      case 'status':
        return { key: t.status, label: cap(t.status) };
      default:
        return { key: '~none', label: '—' };
    }
  };

  for (const t of tasks) {
    const { key, label } = keyOf(t);
    const bucket = buckets.get(key) ?? { label, items: [] };
    bucket.items.push(t);
    buckets.set(key, bucket);
  }

  const orderIndex = (key: string): number => {
    if (groupBy === 'status') return STATUS_ORDER.indexOf(key) === -1 ? 99 : STATUS_ORDER.indexOf(key);
    if (groupBy === 'priority') return PRIORITY_ORDER.indexOf(key) === -1 ? 99 : PRIORITY_ORDER.indexOf(key);
    return 0;
  };

  return [...buckets.entries()]
    .sort(([ka, va], [kb, vb]) => {
      const oi = orderIndex(ka) - orderIndex(kb);
      if (oi !== 0) return oi;
      // "~none" last, then alphabetical by label.
      if (ka === '~none') return 1;
      if (kb === '~none') return -1;
      return va.label.localeCompare(vb.label);
    })
    .map(([key, v]) => ({ key, label: v.label.toUpperCase(), items: [...v.items].sort(byRecent) }));
}

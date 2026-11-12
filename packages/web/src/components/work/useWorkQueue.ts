/**
 * useWorkQueue — the single place that joins the real stores into the Work
 * view's model. It loads tickets/boards/activity, builds a WorkTask per ticket
 * in scope (status doing/reviewing across all boards), partitions them into the
 * three queue sections, adds the pinned ticket when the filters exclude it, and
 * resolves the selected task. Every Work component
 * consumes this; none reaches into a store for queue data itself.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentActivityState, BoardWithCounts, Ticket, TicketGroup, TicketLink } from '@fleex/shared';
import * as api from '../../services/api';
import { useTicketStore } from '../../stores/ticketStore';
import { useTicketActivityStore } from '../../stores/ticketActivityStore';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryStore } from '../../stores/repositoryStore';
import { useWorkflowRunStore } from '../../stores/workflowRunStore';
import { useWorkStore } from '../../stores/workStore';
import { idleActivitySource, threadActivityDetail, threadTargetLabel } from './selectors';
import { useThreadStore } from '../../stores/threadStore';
import { useAgentPersonaStore } from '../../stores/agentPersonaStore';
import { matchQueueFilters, pruneUnknown, type KnownIds, type QueueConfig, type QueueFilterKey } from './queueFilters';
import { groupTasks } from './queueGrouping';
import type { WorkTask, WorkWorktree, WorkEpic, QueueGroup } from './types';
import { prLinksFor } from './queue/prLinks';

/** How often the queue re-reads its PRs' state from GitHub (it changes without a Fleex event). */
const PR_DETAILS_REFRESH_MS = 2 * 60_000;

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

/**
 * The queue filters that hide `ticket`, judged from the ticket alone — for
 * callers outside the queue (RouterSync deciding whether to pin a deep link).
 * Without live data, PR states are unknown and activity falls back to the
 * ticket's dates, so it errs towards "hidden": a needless pin is invisible (the
 * queue only shows a pin its filters exclude), a missing one is not.
 */
export function ticketExcludedBy(
  config: QueueConfig,
  search: string,
  ticket: Ticket,
  now: number = Date.now(),
): QueueFilterKey[] {
  return matchQueueFilters(config.filters, search, {
    boardId: ticket.boardId,
    status: ticket.status,
    priority: ticket.priority,
    complexity: ticket.complexity ?? null,
    type: ticket.type,
    favorite: ticket.favorite,
    blocked: ticket.blocked,
    title: ticket.title,
    epics: ticket.epics ?? [],
    worktrees: reposFromLinks(ticket.links),
    prs: ticket.links.filter((l) => l.type === 'github_pr').map(() => ({ state: null })),
    lastActivityAt: toMs(idleActivitySource(ticket, null)),
  }, now);
}

export interface WorkQueueModel {
  tasks: WorkTask[];
  /** Ordered, grouped rows for the current groupBy. */
  groups: QueueGroup[];
  /** Flattened display order of ids (drives ⌘⇧↑/↓) — the out-of-filters pin first. */
  orderedIds: string[];
  /**
   * The pinned ticket when the filters exclude it (shown in its own section on
   * top of the queue, not counted), with the filters that exclude it. Null when
   * there is no pin or it passes the filters (then it's an ordinary row).
   */
  pinned: { task: WorkTask; excludedBy: QueueFilterKey[] } | null;
  /** WorkTask lookup by id. */
  byId: Map<string, WorkTask>;
  boards: BoardWithCounts[];
  /** Every epic (for the Epic filter); empty until loaded. */
  epics: TicketGroup[];
  /** The ids that still exist, to ignore a view's deleted boards / epics (null = not loaded). */
  known: KnownIds;
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
  // Phase 3: a running assistant thread labels the row "<persona> · in thread with assistant".
  const threadsByTicket = useThreadStore((s) => s.threadsByTicket);
  const personas = useAgentPersonaStore((s) => s.personas);
  const sinceByTicket = useTicketActivityStore((s) => s.sinceByTicket);
  const lastActivityAtByTicket = useTicketActivityStore((s) => s.lastActivityAtByTicket);
  const runningExecutionIdByTicket = useTicketActivityStore((s) => s.runningExecutionIdByTicket);
  const costByTicket = useTicketActivityStore((s) => s.costByTicket);
  const loadActivity = useTicketActivityStore((s) => s.loadActivity);

  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const runsByTicket = useWorkflowRunStore((s) => s.runsByTicket);

  const queueConfig = useWorkStore((s) => s.queueConfig);
  const search = useWorkStore((s) => s.search);
  const selectedTicketId = useWorkStore((s) => s.selectedTicketId);
  const pinnedTicketId = useWorkStore((s) => s.pinnedTicketId);

  // Prime tickets/boards once. useTickets() may already be mounted higher up;
  // fetching again is cheap and keeps the view self-sufficient when it isn't.
  // `ticketsLoaded` tells "not loaded yet" from "doesn't exist" for the pin.
  const [ticketsLoaded, setTicketsLoaded] = useState(false);
  useEffect(() => {
    void fetchBoards();
    void fetchTickets().then(() => setTicketsLoaded(true), () => setTicketsLoaded(true));
    void fetchRepositories();
  }, [fetchBoards, fetchTickets, fetchRepositories]);

  // Every epic, for the Epic filter and to tell a view's deleted epic apart. Kept
  // local: ticketGroupStore.groups is the Kanban's board-scoped list.
  const [epics, setEpics] = useState<TicketGroup[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    api.fetchTicketGroups().then(
      (groups) => { if (!cancelled) setEpics(groups); },
      () => {},
    );
    return () => { cancelled = true; };
  }, []);

  // Board / epic ids that no longer exist are ignored by the filters (a saved
  // view may still reference them) — once the lists are loaded.
  const known = useMemo<KnownIds>(
    () => ({
      boards: boards.length > 0 ? new Set(boards.map((b) => b.id)) : null,
      epics: epics ? new Set(epics.map((e) => e.id)) : null,
    }),
    [boards, epics],
  );
  const filters = useMemo(() => pruneUnknown(queueConfig, known).filters, [queueConfig, known]);
  const statusFilters = filters.statuses;

  const pinnedTicket = useMemo<Ticket | null>(
    () => (pinnedTicketId ? tickets.find((t) => t.id === pinnedTicketId) ?? null : null),
    [tickets, pinnedTicketId],
  );

  // A pin whose ticket is gone (deleted elsewhere) is dropped, once we know.
  useEffect(() => {
    if (ticketsLoaded && pinnedTicketId && !pinnedTicket) useWorkStore.getState().unpinTicket();
  }, [ticketsLoaded, pinnedTicketId, pinnedTicket]);

  // The tickets in queue scope = those whose status is in the status filter
  // (defaults to doing + reviewing). An empty filter shows every status.
  const statusFilterKey = statusFilters.join(',');
  const scopedTickets = useMemo(() => {
    const set = new Set(statusFilters);
    return set.size === 0 ? tickets : tickets.filter((t) => set.has(t.status));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, statusFilterKey]);
  // The pin's activity is loaded too: it may sit outside the status scope.
  const scopedIds = useMemo(() => {
    const ids = scopedTickets.map((t) => t.id);
    if (pinnedTicket && !ids.includes(pinnedTicket.id)) ids.push(pinnedTicket.id);
    return ids;
  }, [scopedTickets, pinnedTicket]);
  const scopedIdsKey = scopedIds.join(',');

  useEffect(() => {
    if (scopedIds.length > 0) void loadActivity(scopedIds);
    // scopedIdsKey collapses the array identity to a stable string.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopedIdsKey, loadActivity]);

  // Every PR linked to a ticket in scope, fetched in one batch for the queue's PR
  // glyph and refreshed periodically.
  const prRefsKey = useMemo(() => {
    const refs = new Set<string>();
    const all = pinnedTicket ? [...scopedTickets, pinnedTicket] : scopedTickets;
    for (const t of all) for (const l of t.links) if (l.type === 'github_pr') refs.add(l.ref);
    return [...refs].sort().join('\n');
  }, [scopedTickets, pinnedTicket]);
  const [prDetails, setPrDetails] = useState<Record<string, api.PullRequestDetails>>({});
  useEffect(() => {
    if (!prRefsKey) return;
    const refs = prRefsKey.split('\n');
    let cancelled = false;
    const load = () => {
      api
        .fetchBulkPRDetails(refs)
        .then((details) => {
          if (!cancelled) setPrDetails((prev) => ({ ...prev, ...details }));
        })
        .catch(() => {});
    };
    load();
    const timer = setInterval(load, PR_DETAILS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [prRefsKey]);

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

  // A ticket's epics come with the list endpoint only; a ticket replaced by an
  // event or a mutation response has none, so the last known ones are kept.
  const epicsCache = useRef(new Map<string, WorkEpic[]>());
  const epicsOf = useCallback((t: Ticket): WorkEpic[] => {
    if (t.epics) {
      const list = t.epics.map((e) => ({ id: e.id, name: e.name, emoji: e.emoji }));
      epicsCache.current.set(t.id, list);
      return list;
    }
    return epicsCache.current.get(t.id) ?? [];
  }, []);

  const toTask = useCallback((t: Ticket): WorkTask => {
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
    const wtStats = diffStatsByTicket.get(t.id);
    let pr: WorkTask['pr'] = null;
    if (prBase) {
      pr = {
        ref: prBase.ref,
        checksLabel: null,
        additions: wtStats?.additions ?? null,
        deletions: wtStats?.deletions ?? null,
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
      complexity: t.complexity ?? null,
      favorite: t.favorite,
      blocked: t.blocked,
      epics: epicsOf(t),
      createdAt: toMs(t.createdAt),
      activity,
      activityDetail:
        threadActivityDetail(threadsByTicket[t.id] ?? [], (th) => threadTargetLabel(th, personas.find((p) => p.id === th.personaId)?.displayName)) ??
        detailByTicket[t.id] ?? null,
      since: toMs(sinceByTicket[t.id]),
      lastActivityAt: toMs(idleActivitySource(t, lastActivityAtByTicket[t.id])),
      cost: costByTicket[t.id] ?? null,
      runningExecutionId: runningExecutionIdByTicket[t.id] ?? null,
      progress,
      worktrees,
      suggestedRepos: [],
      changedLines: wtStats ? wtStats.additions + wtStats.deletions : 0,
      pr,
      prs: prLinksFor(t.links, prDetails),
      deliverableCount: 0,
      sessionCount: sessionCountByTicket.get(t.id) ?? 0,
    } satisfies WorkTask;
  }, [
    activityByTicket,
    detailByTicket,
    threadsByTicket,
    personas,
    sinceByTicket,
    lastActivityAtByTicket,
    costByTicket,
    runningExecutionIdByTicket,
    sessionCountByTicket,
    diffStatsByTicket,
    runsByTicket,
    boardById,
    prDetails,
    epicsOf,
  ]);

  // "Inactive for" compares against now: re-evaluated with the data, and each minute.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!filters.inactiveFor) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [filters.inactiveFor]);

  const tasks = useMemo<WorkTask[]>(
    () => scopedTickets.map(toTask).filter((t) => matchQueueFilters(filters, search, t, now).length === 0),
    [scopedTickets, filters, search, toTask, now],
  );

  const pinned = useMemo<WorkQueueModel['pinned']>(() => {
    if (!pinnedTicket) return null;
    const task = toTask(pinnedTicket);
    const reasons = matchQueueFilters(filters, search, task, now);
    return reasons.length > 0 ? { task, excludedBy: reasons } : null;
  }, [pinnedTicket, filters, search, toTask, now]);

  const byId = useMemo(() => {
    const m = new Map<string, WorkTask>();
    for (const t of tasks) m.set(t.id, t);
    if (pinned) m.set(pinned.task.id, pinned.task);
    return m;
  }, [tasks, pinned]);

  const display = queueConfig.display;
  const groups = useMemo<QueueGroup[]>(() => groupTasks(tasks, display), [tasks, display]);

  const orderedIds = useMemo(
    () => [...(pinned ? [pinned.task.id] : []), ...groups.flatMap((g) => g.items.map((t) => t.id))],
    [groups, pinned],
  );

  // Selected task: the persisted selection when it's in the queue or pinned,
  // else the first row in display order. Never a fallback while the pinned
  // selection is still loading — a deep link would be replaced on first paint.
  const pinLoading = !ticketsLoaded && !!selectedTicketId && selectedTicketId === pinnedTicketId && !pinnedTicket;
  const selectedTask = useMemo<WorkTask | null>(() => {
    if (selectedTicketId && byId.has(selectedTicketId)) return byId.get(selectedTicketId)!;
    if (pinLoading) return null;
    const fallback = orderedIds[0] ?? null;
    return fallback ? byId.get(fallback) ?? null : null;
  }, [selectedTicketId, pinLoading, byId, orderedIds]);

  const counts = useMemo(
    () => ({
      total: tasks.length,
      running: tasks.filter((t) => t.activity === 'running').length,
      needs: tasks.filter((t) => t.activity === 'waiting').length,
    }),
    [tasks],
  );

  return { tasks, groups, orderedIds, pinned, byId, boards, epics: epics ?? NO_EPICS, known, selectedTask, counts };
}

const NO_EPICS: TicketGroup[] = [];

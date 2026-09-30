/**
 * Gathers everything the ticket Timeline derives from — ONLY existing
 * endpoints and stores (SPEC §4), no new data — and memoises the pure
 * `buildTimeline` over it. Live over the existing WS channels:
 *  - comments: applied in place (comment:created/updated/deleted);
 *  - activity log: refetched on ticket:updated / ticket:moved (no activity event);
 *  - mentions: refetched (debounced) on mention:*;
 *  - workflow runs: `applyEvent` on workflow:*, and every run's detail is loaded;
 *  - executions, deliverables, PRs, sessions: their stores are already live.
 * "now" ticks every 60 s so the now line advances.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  TicketActivity,
  TicketComment,
  TicketDeliverable,
  TicketMention,
  TicketWsMessage,
} from '@fleex/shared';
import * as api from '../../../services/api';
import { appWs } from '../../../services/websocket';
import { useTicketStore } from '../../../stores/ticketStore';
import { useAgentEventStore } from '../../../stores/agentEventStore';
import { useWorkflowRunStore } from '../../../stores/workflowRunStore';
import { useAgentPersonaStore } from '../../../stores/agentPersonaStore';
import { usePanelStore } from '../../../stores/panelStore';
import { useSkillStore } from '../../../stores/skillStore';
import { useUnreadStore } from '../../../stores/unreadStore';
import { usePullRequestStore } from '../../../stores/pullRequestStore';
import { useSessionStore } from '../../../stores/sessionStore';
import type { WorkTask } from '../types';
import {
  buildTimeline,
  type PrDates,
  type RunWithSteps,
  type SessionInfo,
  type TimelineModel,
  type TimelineNames,
} from './buildTimeline';

/** Enough for any real ticket's history (the server clamps to 1000). */
const ACTIVITY_LIMIT = 1000;
const NOW_TICK_MS = 60_000;
const EMPTY_EXECUTIONS: never[] = [];
const EMPTY_RUNS: never[] = [];
const EMPTY_SEEN: ReadonlySet<string> = new Set();

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS);
    return () => clearInterval(id);
  }, []);
  return now;
}

export interface TicketTimelineData {
  model: TimelineModel | null;
  loading: boolean;
}

export function useTicketTimeline(task: WorkTask, deliverables: readonly TicketDeliverable[]): TicketTimelineData {
  const ticketId = task.id;
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === ticketId));
  const now = useMinuteClock();

  // ── Ticket-scoped fetches ──
  const [activities, setActivities] = useState<TicketActivity[]>([]);
  const [comments, setComments] = useState<TicketComment[]>([]);
  const [mentions, setMentions] = useState<TicketMention[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.fetchTicketActivity(ticketId, { limit: ACTIVITY_LIMIT }).catch(() => [] as TicketActivity[]),
      api.fetchTicketComments(ticketId).catch(() => [] as TicketComment[]),
      api.fetchTicketMentions(ticketId).catch(() => [] as TicketMention[]),
    ]).then(([a, c, m]) => {
      if (cancelled) return;
      setActivities(a);
      setComments(c);
      setMentions(m);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [ticketId]);

  const mentionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = appWs.onChannel('tickets', (raw) => {
      const msg = raw as TicketWsMessage;
      const data = msg.data as { id?: string; ticketId?: string } | null;
      if (msg.type === 'comment:created' || msg.type === 'comment:updated') {
        const c = msg.data as TicketComment;
        if (c.ticketId !== ticketId) return;
        setComments((prev) => (prev.some((x) => x.id === c.id) ? prev.map((x) => (x.id === c.id ? c : x)) : [...prev, c]));
      } else if (msg.type === 'comment:deleted') {
        if (data?.ticketId === ticketId) setComments((prev) => prev.filter((x) => x.id !== data.id));
      } else if (msg.type === 'ticket:updated' || msg.type === 'ticket:moved') {
        if (data?.id === ticketId) {
          api.fetchTicketActivity(ticketId, { limit: ACTIVITY_LIMIT }).then(setActivities).catch(() => {});
        }
      } else if (msg.type.startsWith('mention:')) {
        if (data?.ticketId !== ticketId) return;
        if (mentionTimer.current) clearTimeout(mentionTimer.current);
        mentionTimer.current = setTimeout(() => {
          api.fetchTicketMentions(ticketId).then(setMentions).catch(() => {});
        }, 500);
      } else if (msg.type.startsWith('workflow:')) {
        if (data?.ticketId !== ticketId) return;
        useWorkflowRunStore.getState().applyEvent({ type: msg.type, ticketId, payload: msg.data as Record<string, unknown> });
      }
    });
    return () => {
      unsub();
      if (mentionTimer.current) clearTimeout(mentionTimer.current);
    };
  }, [ticketId]);

  // ── Executions (store, live via the agent-events channel) ──
  const executions = useAgentEventStore((s) => s.executionsByTicket[ticketId] ?? EMPTY_EXECUTIONS);
  useEffect(() => {
    const s = useAgentEventStore.getState();
    void s.loadExecutionsForTicket(ticketId);
    s.subscribeTicket(ticketId);
    // No unsubscribe: TaskPane shares this subscription for the same ticket, and
    // the store's set dedupes — unsubscribing here would cut TaskPane off.
  }, [ticketId]);

  // ── Workflow runs + the detail of every run (step runs live in the detail) ──
  const runs = useWorkflowRunStore((s) => s.runsByTicket[ticketId] ?? EMPTY_RUNS);
  const detail = useWorkflowRunStore((s) => s.detail);
  useEffect(() => {
    void useWorkflowRunStore.getState().loadForTicket(ticketId);
  }, [ticketId]);
  const runKey = runs.map((r) => `${r.id}:${r.status}:${r.updatedAt}`).join('|');
  useEffect(() => {
    for (const r of runs) void useWorkflowRunStore.getState().loadDetail(r.id);
    // runKey captures what matters in `runs`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  // ── Names ──
  const personas = useAgentPersonaStore((s) => s.personas);
  const personasLoaded = useAgentPersonaStore((s) => s.loaded);
  const panels = usePanelStore((s) => s.panels);
  const panelsLoaded = usePanelStore((s) => s.loaded);
  const skills = useSkillStore((s) => s.skills);
  const skillsLoaded = useSkillStore((s) => s.loaded);
  useEffect(() => {
    if (!personasLoaded) void useAgentPersonaStore.getState().loadPersonas();
    if (!panelsLoaded) void usePanelStore.getState().loadPanels();
    if (!skillsLoaded) void useSkillStore.getState().loadSkills();
  }, [personasLoaded, panelsLoaded, skillsLoaded]);

  const names = useMemo<TimelineNames>(() => {
    const p: Record<string, string> = {};
    for (const x of personas) {
      const n = x.displayName || x.name;
      p[x.id] = n;
      p[x.name] = n;
    }
    const pa: TimelineNames['panels'] = {};
    for (const x of panels) {
      const entry = { name: x.displayName || x.name, members: x.members.map((m) => p[m.personaId]).filter((n): n is string => !!n) };
      pa[x.id] = entry;
      pa[x.name] = entry;
    }
    const sk: Record<string, string> = {};
    for (const x of skills) {
      const n = x.displayName || x.name;
      sk[x.id] = n;
      sk[x.name] = n;
      sk[x.commandName] = n;
    }
    return { personas: p, panels: pa, skills: sk };
  }, [personas, panels, skills]);

  // ── Unread deliverables ──
  const seen = useUnreadStore((s) => s.seenDeliverablesByTicket[ticketId]) ?? EMPTY_SEEN;

  // ── PR opening dates (repo PR polling) ──
  const pullsByRepo = usePullRequestStore((s) => s.pullsByRepo);
  const prRepoKey = task.prs.map((p) => p.ref.split('#')[0]).join(',');
  useEffect(() => {
    // Repos the polling doesn't cover yet: one fetch so the real opening date is known.
    const store = usePullRequestStore.getState();
    for (const repo of new Set(prRepoKey.split(',').filter(Boolean))) {
      if (store.pullsByRepo[repo]) continue;
      const [org, name] = repo.split('/');
      if (org && name) void store.fetchPullsForRepo(org, name);
    }
  }, [prRepoKey]);
  const prDates = useMemo<Record<string, PrDates>>(() => {
    const out: Record<string, PrDates> = {};
    for (const pr of task.prs) {
      const [repo, num] = pr.ref.split('#');
      const found = Object.values(pullsByRepo[repo ?? ''] ?? {}).find((p) => String(p.number) === num);
      if (found) out[pr.ref] = { createdAt: found.createdAt, mergedAt: found.mergedAt ?? null, branch: found.headRefName };
    }
    return out;
  }, [task.prs, pullsByRepo]);

  // ── Live tmux sessions ──
  const liveSessions = useSessionStore((s) => s.sessions);
  const sessions = useMemo<Record<string, SessionInfo>>(() => {
    const out: Record<string, SessionInfo> = {};
    for (const s of liveSessions) {
      out[s.id] = {
        type: s.type === 'claude' ? 'claude' : 'shell',
        status: s.status,
        title: s.displayName || s.tmuxName,
        branch: s.worktreeBranch,
      };
    }
    return out;
  }, [liveSessions]);

  const runsWithSteps = useMemo<RunWithSteps[]>(
    () => runs.map((run) => ({ run: detail[run.id]?.run ?? run, stepRuns: detail[run.id]?.stepRuns ?? [] })),
    [runs, detail],
  );

  const model = useMemo(() => {
    const createdAt = ticket?.createdAt;
    if (!createdAt) return null;
    return buildTimeline(
      {
        ticket: {
          id: ticketId,
          status: ticket.status,
          createdAt,
          statusChangedAt: ticket.statusChangedAt ?? null,
          updatedAt: ticket.updatedAt,
          links: ticket.links,
        },
        activities,
        comments,
        deliverables,
        seenDeliverableIds: seen,
        executions,
        mentions,
        runs: runsWithSteps,
        prs: task.prs,
        prDates,
        sessions,
        names,
      },
      now,
    );
  }, [ticket, ticketId, activities, comments, deliverables, seen, executions, mentions, runsWithSteps, task.prs, prDates, sessions, names, now]);

  return { model, loading };
}

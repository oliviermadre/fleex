import type {
  StatisticsResponse,
  StatisticsTimeBucket,
  StatisticsSummary,
  AgentLeaderboardEntry,
  SkillLeaderboardEntry,
  PanelLeaderboardEntry,
  AgentExecution,
  TicketLink,
  UsageByTypeBucket,
  ActivityHeatmapCell,
  TicketIterations,
  LeadTimePoint,
  LeadTimeStats,
  CumulativeFlowBucket,
  CycleTimeStatus,
  ThroughputWipBucket,
  WorkflowLeaderboardEntry,
} from '@fleex/shared';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { CommentStorePort } from '../ports/comment-store.port.js';
import type { MentionStorePort } from '../ports/mention-store.port.js';
import type { DeliverableStorePort } from '../ports/deliverable-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { PersonaStorePort } from '../ports/persona-store.port.js';
import type { SessionStorePort } from '../ports/session-store.port.js';
import type { SkillStorePort } from '../ports/skill-store.port.js';
import type { DomainEventLogStorePort } from '../ports/domain-event-log-store.port.js';
import type { WorkflowRunStorePort } from '../ports/workflow-run-store.port.js';
import {
  FLOW_STATUSES,
  MOVE_EVENTS_FETCH_LIMIT,
  PANEL_EVENTS_FETCH_LIMIT,
  STATS_CACHE_TTL_MS,
} from '../utils/statistics/constants.js';
import { percentile } from '../utils/statistics/math.js';
import { buildBuckets } from '../utils/statistics/buckets.js';

interface CacheEntry {
  data: StatisticsResponse;
  expiresAt: number;
}

/** A persisted domain-event-log row, as returned by the store port. */
type LogEntry = Awaited<ReturnType<DomainEventLogStorePort['list']>>[number];

/** Execution origin for the cost-by-source breakdown. NULL is read as agentic (`sdk`). */
function sourceOf(e: AgentExecution): 'sdk' | 'cli' {
  return e.source === 'cli' ? 'cli' : 'sdk';
}

/** Sum costUsd grouped by source over a set of executions. */
function costBySourceOf(execs: AgentExecution[]): { sdk: number; cli: number } {
  const acc = { sdk: 0, cli: 0 };
  for (const e of execs) acc[sourceOf(e)] += e.costUsd ?? 0;
  return acc;
}

export class GetStatisticsUseCase {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly commentStore: CommentStorePort,
    private readonly mentionStore: MentionStorePort,
    private readonly deliverableStore: DeliverableStorePort,
    private readonly agentEventStore: AgentEventStorePort,
    private readonly personaStore: PersonaStorePort,
    private readonly sessionStore: SessionStorePort,
    private readonly skillStore?: SkillStorePort,
    private readonly domainEventLogStore?: DomainEventLogStorePort,
    private readonly workflowRunStore?: WorkflowRunStorePort | null,
  ) {}

  async execute(params: {
    from: string;
    to: string;
    granularity: 'day' | 'week' | 'month';
    /** Client's Date.getTimezoneOffset() in minutes; buckets the heatmap in the user's local time. */
    tzOffsetMinutes?: number;
  }): Promise<StatisticsResponse> {
    const tzOffsetMinutes = params.tzOffsetMinutes ?? 0;
    const cacheKey = `${params.from}:${params.to}:${params.granularity}:${tzOffsetMinutes}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data;
    }

    const from = new Date(params.from);
    const to = new Date(params.to);
    const inRange = (dateStr: string) => {
      const d = new Date(dateStr);
      return d >= from && d <= to;
    };

    const [tickets, boards, comments, mentions, deliverables, executions, personas, sessions] =
      await Promise.all([
        this.ticketStore.getAllTickets(),
        this.ticketStore.getAllBoards(),
        this.commentStore.getAll(),
        this.mentionStore.getAll(),
        this.deliverableStore.getAll(),
        this.agentEventStore.getAllExecutions(),
        this.personaStore.getAll(),
        this.sessionStore.getAll(),
      ]);

    // Board lookup (boardId → display name), used by the "tickets done by board" chart
    const boardNameById = new Map(boards.map((b) => [b.id, b.name]));

    // Filter to date range
    const filteredTickets = tickets.filter((t) => inRange(t.toDTO().createdAt));
    const filteredComments = comments.filter((c) => inRange(c.toDTO().createdAt));
    const filteredMentions = mentions.filter((m) => inRange(m.toDTO().createdAt));
    const filteredDeliverables = deliverables.filter((d) => inRange(d.toDTO().createdAt));
    const filteredExecutions = executions.filter((e) => inRange(e.startedAt));
    const filteredSessions = sessions.filter((s) => inRange(s.createdAt.toISOString()));

    // Compute summary
    const completedTickets = filteredTickets.filter((t) => t.toDTO().status === 'done');
    const worktreeSessions = filteredSessions.filter((s) => {
      const dto = s as unknown as Record<string, unknown>;
      return dto.worktreeBranch || dto.type === 'claude';
    });
    const prLinks = filteredTickets.flatMap((t) =>
      t.toDTO().links.filter((l: TicketLink) => l.type === 'github_pr'),
    );
    const mergedTickets = tickets.filter(
      (t) => t.toDTO().status === 'done' && t.toDTO().links.some((l: TicketLink) => l.type === 'github_pr'),
    ).filter((t) => inRange(t.toDTO().statusChangedAt));

    const userComments = filteredComments.filter((c) => c.toDTO().authorType === 'user');
    const agentComments = filteredComments.filter((c) => c.toDTO().authorType === 'agent');
    const resolvedMentions = filteredMentions.filter((m) => m.toDTO().status === 'resolved');

    const durations = filteredExecutions
      .filter((e) => e.completedAt)
      .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime());
    const avgDuration = durations.length > 0
      ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
      : null;

    const skillExecutions = filteredExecutions.filter((e) => e.mentionId.startsWith('skill:'));

    const summary: StatisticsSummary = {
      worktreesCreated: worktreeSessions.length,
      prsCreated: prLinks.length,
      prsMerged: mergedTickets.length,
      agentsSpawned: filteredExecutions.length,
      avgAgentDurationMs: avgDuration,
      deliverablesCreated: filteredDeliverables.length,
      commentsCreated: filteredComments.length,
      commentsCreatedByUser: userComments.length,
      commentsCreatedByAgent: agentComments.length,
      mentionsCreated: filteredMentions.length,
      mentionsResolved: resolvedMentions.length,
      ticketsCreated: filteredTickets.length,
      ticketsCompleted: completedTickets.length,
      skillsExecuted: skillExecutions.length,
      panelsExecuted: 0, // Will be updated after panel events are fetched
      workflowsStarted: 0, // Will be updated after workflow events are fetched
      totalCostUsd: filteredExecutions.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
      totalCostBySource: costBySourceOf(filteredExecutions),
      totalInputTokens: filteredExecutions.reduce((sum, e) => sum + (e.inputTokens ?? 0), 0),
      totalOutputTokens: filteredExecutions.reduce((sum, e) => sum + (e.outputTokens ?? 0), 0),
      activeSessions: sessions.filter((s) => {
        const dto = s as unknown as Record<string, unknown>;
        return dto.status === 'active' || dto.status === 'running';
      }).length,
    };

    // Persona lookup (used by time series + leaderboard)
    const personaMap = new Map(personas.map((p) => [p.id, p]));

    // Tickets currently done, paired with their board name. The "tickets done
    // by board" chart buckets these by statusChangedAt (i.e. when they moved to
    // done), regardless of when they were created. Precomputed once here so the
    // bucket loop below doesn't re-resolve toDTO()/board name per bucket.
    const doneTickets = tickets
      .map((t) => t.toDTO())
      .filter((t) => t.status === 'done')
      .map((t) => ({
        statusChangedAt: t.statusChangedAt,
        boardName: boardNameById.get(t.boardId) ?? 'Unknown',
      }));

    // Compute time series
    const buckets = buildBuckets(from, to, params.granularity);
    const timeSeries: StatisticsTimeBucket[] = buckets.map((bucket) => {
      const bucketStart = bucket.start;
      const bucketEnd = bucket.end;
      const inBucket = (dateStr: string) => {
        const d = new Date(dateStr);
        return d >= bucketStart && d < bucketEnd;
      };

      const bTickets = filteredTickets.filter((t) => inBucket(t.toDTO().createdAt));
      const bComments = filteredComments.filter((c) => inBucket(c.toDTO().createdAt));
      const bMentions = filteredMentions.filter((m) => inBucket(m.toDTO().createdAt));
      const bDeliverables = filteredDeliverables.filter((d) => inBucket(d.toDTO().createdAt));
      const bExecutions = filteredExecutions.filter((e) => inBucket(e.startedAt));
      const bSessions = filteredSessions.filter((s) => inBucket(s.createdAt.toISOString()));

      return {
        date: bucket.label,
        worktreesCreated: bSessions.filter((s) => {
          const dto = s as unknown as Record<string, unknown>;
          return dto.worktreeBranch || dto.type === 'claude';
        }).length,
        prsCreated: bTickets.flatMap((t) =>
          t.toDTO().links.filter((l: TicketLink) => l.type === 'github_pr'),
        ).length,
        // Tickets with a PR link that moved to done within this bucket.
        prsMerged: mergedTickets.filter((t) => inBucket(t.toDTO().statusChangedAt)).length,
        agentsSpawned: bExecutions.length,
        deliverablesCreated: bDeliverables.length,
        commentsCreated: bComments.length,
        commentsCreatedByUser: bComments.filter((c) => c.toDTO().authorType === 'user').length,
        commentsCreatedByAgent: bComments.filter((c) => c.toDTO().authorType === 'agent').length,
        mentionsCreated: bMentions.length,
        mentionsResolved: bMentions.filter((m) => m.toDTO().status === 'resolved').length,
        ticketsCreated: bTickets.length,
        ticketsCompleted: bTickets.filter((t) => t.toDTO().status === 'done').length,
        skillsExecuted: bExecutions.filter((e) => e.mentionId.startsWith('skill:')).length,
        // Panels & workflows live outside agent executions — backfilled per
        // bucket from usageByType once those sources are fetched (see below).
        panelsExecuted: 0,
        workflowsStarted: 0,
        totalCostUsd: bExecutions.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
        costBySource: costBySourceOf(bExecutions),
        costByAgent: (() => {
          const byAgent: Record<string, number> = {};
          for (const e of bExecutions) {
            if (e.costUsd == null || e.costUsd === 0) continue;
            const p = personaMap.get(e.personaId);
            const name = p?.displayName ?? p?.name ?? e.personaId;
            byAgent[name] = (byAgent[name] ?? 0) + e.costUsd;
          }
          return byAgent;
        })(),
        ticketsDoneByBoard: (() => {
          const byBoard: Record<string, number> = {};
          for (const t of doneTickets) {
            if (!inBucket(t.statusChangedAt)) continue;
            byBoard[t.boardName] = (byBoard[t.boardName] ?? 0) + 1;
          }
          return byBoard;
        })(),
      };
    });

    // Compute agent leaderboard
    const execByPersona = new Map<string, AgentExecution[]>();
    for (const exec of filteredExecutions) {
      const list = execByPersona.get(exec.personaId) ?? [];
      list.push(exec);
      execByPersona.set(exec.personaId, list);
    }

    const agentLeaderboard: AgentLeaderboardEntry[] = [...execByPersona.entries()]
      .map(([personaId, execs]) => {
        const persona = personaMap.get(personaId);
        const completed = execs.filter((e) => e.status === 'completed');
        const failed = execs.filter((e) => e.status === 'failed');
        const durations = completed
          .filter((e) => e.completedAt)
          .map((e) => new Date(e.completedAt!).getTime() - new Date(e.startedAt).getTime());

        const costs = execs.filter((e) => e.costUsd != null).map((e) => e.costUsd!);
        const inToks = execs.filter((e) => e.inputTokens != null).map((e) => e.inputTokens!);
        const outToks = execs.filter((e) => e.outputTokens != null).map((e) => e.outputTokens!);

        return {
          personaId,
          personaName: persona?.name ?? personaId,
          personaDisplayName: persona?.displayName ?? personaId,
          spawnCount: execs.length,
          avgDurationMs: durations.length > 0
            ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
            : null,
          completedCount: completed.length,
          failedCount: failed.length,
          totalCostUsd: costs.reduce((a, b) => a + b, 0),
          avgCostUsd: costs.length > 0 ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
          totalInputTokens: inToks.reduce((a, b) => a + b, 0),
          totalOutputTokens: outToks.reduce((a, b) => a + b, 0),
          avgInputTokens: inToks.length > 0 ? Math.round(inToks.reduce((a, b) => a + b, 0) / inToks.length) : null,
          avgOutputTokens: outToks.length > 0 ? Math.round(outToks.reduce((a, b) => a + b, 0) / outToks.length) : null,
        };
      })
      .sort((a, b) => b.spawnCount - a.spawnCount);

    // Compute skill leaderboard
    const skills = this.skillStore ? await this.skillStore.getAll() : [];
    const skillMap = new Map(skills.map((s) => [s.id, s]));
    const execBySkill = new Map<string, AgentExecution[]>();
    for (const exec of skillExecutions) {
      const skillId = exec.mentionId.replace('skill:', '');
      const list = execBySkill.get(skillId) ?? [];
      list.push(exec);
      execBySkill.set(skillId, list);
    }

    const skillLeaderboard: SkillLeaderboardEntry[] = [...execBySkill.entries()]
      .map(([skillId, execs]) => {
        const skill = skillMap.get(skillId);
        return {
          skillId,
          skillName: skill?.name ?? skillId,
          skillDisplayName: skill?.displayName ?? skillId,
          executionCount: execs.length,
          completedCount: execs.filter((e) => e.status === 'completed').length,
          failedCount: execs.filter((e) => e.status === 'failed').length,
        };
      })
      .sort((a, b) => b.executionCount - a.executionCount);

    // Compute panel leaderboard from domain event log
    let panelLeaderboard: PanelLeaderboardEntry[] = [];
    let panelExecutionCount = 0;
    let panelEvents: LogEntry[] = [];
    if (this.domainEventLogStore) {
      panelEvents = await this.domainEventLogStore.list({
        limit: PANEL_EVENTS_FETCH_LIMIT,
        eventType: 'panel.executed',
        since: from,
        until: to,
      });
      panelExecutionCount = panelEvents.length;

      const execByPanel = new Map<string, Array<{ status: string; durationMs: number; respondedMembers: number }>>();
      for (const event of panelEvents) {
        const p = event.payload;
        const panelId = (p['panelId'] as string) ?? 'unknown';
        const list = execByPanel.get(panelId) ?? [];
        list.push({
          status: (p['status'] as string) ?? 'completed',
          durationMs: (p['durationMs'] as number) ?? 0,
          respondedMembers: (p['respondedMembers'] as number) ?? 0,
        });
        execByPanel.set(panelId, list);
      }

      panelLeaderboard = [...execByPanel.entries()]
        .map(([panelId, execs]) => {
          const firstEvent = panelEvents.find((e) => e.payload['panelId'] === panelId);
          const eventData = firstEvent?.payload;
          const completed = execs.filter((e) => e.status === 'completed');
          const durations = completed.map((e) => e.durationMs).filter((d) => d > 0);
          const responded = completed.map((e) => e.respondedMembers);

          return {
            panelId,
            panelName: (eventData?.['panelName'] as string) ?? panelId,
            panelDisplayName: (eventData?.['panelDisplayName'] as string) ?? panelId,
            executionCount: execs.length,
            completedCount: completed.length,
            failedCount: execs.filter((e) => e.status === 'failed').length,
            avgDurationMs: durations.length > 0
              ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
              : null,
            avgRespondedMembers: responded.length > 0
              ? Math.round((responded.reduce((a, b) => a + b, 0) / responded.length) * 10) / 10
              : null,
          };
        })
        .sort((a, b) => b.executionCount - a.executionCount);
    }

    // Update panelsExecuted in summary now that we have the count
    const updatedSummary = { ...summary, panelsExecuted: panelExecutionCount };

    // ── Extended analytics ─────────────────────────────────────────────────
    // All derived from data already loaded above plus the domain event log
    // (audit trail) — no schema changes or new persistence.

    // Activity heatmap (C4): every agent/skill execution by weekday × hour, in
    // the *client's* local time. We shift the absolute instant by the client's
    // tz offset and read UTC getters, so the result is independent of the
    // server's timezone (no double-shift if the server isn't UTC).
    const tzShiftMs = tzOffsetMinutes * 60_000;
    const heatCounts = new Map<string, number>();
    for (const e of filteredExecutions) {
      const t = new Date(e.startedAt).getTime();
      if (Number.isNaN(t)) continue;
      const local = new Date(t - tzShiftMs);
      const key = `${local.getUTCDay()}:${local.getUTCHours()}`;
      heatCounts.set(key, (heatCounts.get(key) ?? 0) + 1);
    }
    const activityHeatmap: ActivityHeatmapCell[] = [...heatCounts.entries()].map(([key, count]) => {
      const [dow, hour] = key.split(':').map(Number) as [number, number];
      return { dow, hour, count };
    });

    // Full ticket-move history (audit log) + every workflow run. Moves are
    // fetched with no lower bound so lead time / CFD can see transitions that
    // happened before `from`. Workflow stats come from the run store (richer:
    // template name, status, duration) rather than the event log.
    let moveEvents: LogEntry[] = [];
    const [allRuns, fetchedMoves] = await Promise.all([
      this.workflowRunStore ? this.workflowRunStore.getAll() : Promise.resolve([]),
      this.domainEventLogStore
        ? this.domainEventLogStore.list({ limit: MOVE_EVENTS_FETCH_LIMIT, eventType: 'ticket.moved', until: to })
        : Promise.resolve([] as LogEntry[]),
    ]);
    moveEvents = fetchedMoves;
    const filteredRuns = allRuns.filter((r) => {
      const t = r.startedAt.getTime();
      return t >= from.getTime() && t <= to.getTime();
    });

    // Workflows started within the selected window (summary KPI).
    const workflowsStarted = filteredRuns.length;

    // Usage trend by execution mode (C13).
    const usageByType: UsageByTypeBucket[] = buckets.map((bucket) => {
      const inB = (d: Date) => d >= bucket.start && d < bucket.end;
      const bExec = filteredExecutions.filter((e) => inB(new Date(e.startedAt)));
      return {
        date: bucket.label,
        agents: bExec.filter((e) => !e.mentionId.startsWith('skill:')).length,
        skills: bExec.filter((e) => e.mentionId.startsWith('skill:')).length,
        panels: panelEvents.filter((e) => inB(e.occurredAt)).length,
        workflows: filteredRuns.filter((r) => inB(r.startedAt)).length,
      };
    });

    // Backfill per-bucket panels/workflows into the time series (same bucket
    // order) so their KPI sparklines use the timeSeries path like every other
    // metric.
    const enrichedTimeSeries: StatisticsTimeBucket[] = timeSeries.map((b, i) => ({
      ...b,
      panelsExecuted: usageByType[i]?.panels ?? b.panelsExecuted,
      workflowsStarted: usageByType[i]?.workflows ?? 0,
    }));

    // Per-ticket move timelines (sorted ascending).
    const movesByTicket = new Map<string, Array<{ at: Date; to: string }>>();
    for (const ev of moveEvents) {
      const tid = ev.payload['ticketId'] as string | undefined;
      const toStatus = ev.payload['toStatus'] as string | undefined;
      if (!tid || !toStatus) continue;
      const list = movesByTicket.get(tid) ?? [];
      list.push({ at: ev.occurredAt, to: toStatus });
      movesByTicket.set(tid, list);
    }
    for (const list of movesByTicket.values()) list.sort((a, b) => a.at.getTime() - b.at.getTime());

    // Status of a ticket as of a point in time (null before it existed).
    const statusAtTime = (ticket: { id: string; createdAt: string }, time: Date): string | null => {
      const created = new Date(ticket.createdAt);
      if (Number.isNaN(created.getTime()) || created > time) return null;
      let status = 'backlog';
      for (const mv of movesByTicket.get(ticket.id) ?? []) {
        if (mv.at <= time) status = mv.to;
        else break;
      }
      return status;
    };

    // Per-ticket interaction counts (full history, used by C14).
    const mentionTicket = new Map<string, string>();
    const mentionsByTicket = new Map<string, number>();
    for (const m of mentions) {
      const dto = m.toDTO();
      mentionTicket.set(dto.id, dto.ticketId);
      mentionsByTicket.set(dto.ticketId, (mentionsByTicket.get(dto.ticketId) ?? 0) + 1);
    }
    const commentsByTicket = new Map<string, number>();
    for (const c of comments) {
      const tid = c.toDTO().ticketId;
      commentsByTicket.set(tid, (commentsByTicket.get(tid) ?? 0) + 1);
    }
    const agentRunsByTicket = new Map<string, number>();
    for (const e of executions) {
      if (e.mentionId.startsWith('skill:')) continue;
      const tid = mentionTicket.get(e.mentionId);
      if (!tid) continue;
      agentRunsByTicket.set(tid, (agentRunsByTicket.get(tid) ?? 0) + 1);
    }
    const workflowRunsByTicket = new Map<string, number>();
    for (const r of allRuns) {
      workflowRunsByTicket.set(r.ticketId, (workflowRunsByTicket.get(r.ticketId) ?? 0) + 1);
    }

    // Walk every ticket once to derive lead time, iterations, cycle time and
    // the set of completions in range.
    const ticketDTOs = tickets.map((t) => t.toDTO());
    const leadPoints: LeadTimePoint[] = [];
    const ticketIterations: TicketIterations[] = [];
    const doneDates: Date[] = [];
    const cycleAccum = new Map<string, { total: number; count: number }>();

    for (const t of ticketDTOs) {
      const moves = movesByTicket.get(t.id) ?? [];
      let firstDoing: Date | null = null;
      let lastDone: Date | null = null;
      for (const mv of moves) {
        if (mv.to === 'doing' && !firstDoing) firstDoing = mv.at;
        if (mv.to === 'done') lastDone = mv.at;
      }
      // Fallback for tickets done before move history was recorded.
      if (!lastDone && t.status === 'done') {
        const sca = new Date(t.statusChangedAt);
        if (!Number.isNaN(sca.getTime())) lastDone = sca;
      }
      if (!lastDone || lastDone < from || lastDone >= to) continue;
      doneDates.push(lastDone);

      const mentionsN = mentionsByTicket.get(t.id) ?? 0;
      const commentsN = commentsByTicket.get(t.id) ?? 0;
      const workflowN = workflowRunsByTicket.get(t.id) ?? 0;
      ticketIterations.push({
        ticketId: t.id,
        title: t.title,
        mentions: mentionsN,
        comments: commentsN,
        agentRuns: agentRunsByTicket.get(t.id) ?? 0,
        workflowRuns: workflowN,
        total: mentionsN + commentsN + workflowN,
      });

      if (firstDoing && lastDone.getTime() >= firstDoing.getTime()) {
        leadPoints.push({
          ticketId: t.id,
          title: t.title,
          doneAt: lastDone.toISOString(),
          leadTimeMs: lastDone.getTime() - firstDoing.getTime(),
        });
      }

      // Cycle time: time held in each (non-terminal) status until the done.
      const seq: Array<{ at: Date; status: string }> = [{ at: new Date(t.createdAt), status: 'backlog' }];
      for (const mv of moves) seq.push({ at: mv.at, status: mv.to });
      seq.sort((a, b) => a.at.getTime() - b.at.getTime());
      for (let i = 0; i < seq.length; i++) {
        const cur = seq[i]!;
        if (cur.status === 'done' || cur.status === 'cancelled') continue;
        const nextAt = i + 1 < seq.length ? seq[i + 1]!.at : lastDone;
        const dur = nextAt.getTime() - cur.at.getTime();
        if (dur <= 0) continue;
        const acc = cycleAccum.get(cur.status) ?? { total: 0, count: 0 };
        acc.total += dur;
        acc.count += 1;
        cycleAccum.set(cur.status, acc);
      }
    }

    const leadMs = leadPoints.map((p) => p.leadTimeMs).sort((a, b) => a - b);
    const leadTime: LeadTimeStats = {
      points: leadPoints,
      avgMs: leadMs.length > 0 ? Math.round(leadMs.reduce((a, b) => a + b, 0) / leadMs.length) : null,
      medianMs: percentile(leadMs, 50),
      p85Ms: percentile(leadMs, 85),
    };

    const cycleTimeByStatus: CycleTimeStatus[] = FLOW_STATUSES.filter((s) => s !== 'done').map((status) => {
      const acc = cycleAccum.get(status);
      return {
        status,
        avgMs: acc && acc.count > 0 ? Math.round(acc.total / acc.count) : null,
        count: acc?.count ?? 0,
      };
    });

    // Workflow leaderboard — runs started in range, grouped by template.
    const runsByTemplate = new Map<string, typeof filteredRuns>();
    for (const r of filteredRuns) {
      const list = runsByTemplate.get(r.templateId) ?? [];
      list.push(r);
      runsByTemplate.set(r.templateId, list);
    }
    const workflowLeaderboard: WorkflowLeaderboardEntry[] = [...runsByTemplate.entries()]
      .map(([templateId, runs]) => {
        const name = runs[0]?.templateSnapshot.name ?? templateId;
        const durations = runs
          .filter((r) => r.status === 'completed' && r.completedAt)
          .map((r) => r.completedAt!.getTime() - r.startedAt.getTime())
          .filter((d) => d > 0);
        return {
          workflowId: templateId,
          workflowName: name,
          workflowDisplayName: name,
          executionCount: runs.length,
          completedCount: runs.filter((r) => r.status === 'completed').length,
          failedCount: runs.filter((r) => r.status === 'failed').length,
          avgDurationMs: durations.length > 0 ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
        };
      })
      .sort((a, b) => b.executionCount - a.executionCount);

    // Cumulative flow (C16) + throughput vs WIP (C18) per bucket.
    const cumulativeFlow: CumulativeFlowBucket[] = [];
    const throughputWip: ThroughputWipBucket[] = [];
    for (const bucket of buckets) {
      const boundary = bucket.end <= to ? bucket.end : to;
      const counts = { backlog: 0, todo: 0, doing: 0, reviewing: 0, done: 0 };
      for (const t of ticketDTOs) {
        const s = statusAtTime(t, boundary);
        if (s && s in counts) counts[s as keyof typeof counts] += 1;
      }
      cumulativeFlow.push({ date: bucket.label, ...counts });
      const completed = doneDates.filter((d) => d >= bucket.start && d < bucket.end).length;
      throughputWip.push({ date: bucket.label, completed, wip: counts.doing + counts.reviewing });
    }

    const result: StatisticsResponse = {
      from: params.from,
      to: params.to,
      granularity: params.granularity,
      summary: { ...updatedSummary, workflowsStarted },
      timeSeries: enrichedTimeSeries,
      agentLeaderboard,
      skillLeaderboard,
      panelLeaderboard,
      workflowLeaderboard,
      usageByType,
      activityHeatmap,
      ticketIterations,
      leadTime,
      cumulativeFlow,
      cycleTimeByStatus,
      throughputWip,
    };

    this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + STATS_CACHE_TTL_MS });

    return result;
  }
}

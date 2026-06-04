import type {
  StatisticsResponse,
  StatisticsTimeBucket,
  StatisticsSummary,
  AgentLeaderboardEntry,
  SkillLeaderboardEntry,
  PanelLeaderboardEntry,
  AgentExecution,
  TicketLink,
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

interface CacheEntry {
  data: StatisticsResponse;
  expiresAt: number;
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
  ) {}

  async execute(params: {
    from: string;
    to: string;
    granularity: 'day' | 'week' | 'month';
  }): Promise<StatisticsResponse> {
    const cacheKey = `${params.from}:${params.to}:${params.granularity}`;
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
      totalCostUsd: filteredExecutions.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
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
    const buckets = this.buildBuckets(from, to, params.granularity);
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
        prsMerged: 0, // Approximation: merge detection is event-based
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
        panelsExecuted: 0, // Panel events are in domain log, not in agent executions
        totalCostUsd: bExecutions.reduce((sum, e) => sum + (e.costUsd ?? 0), 0),
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
    if (this.domainEventLogStore) {
      const panelEvents = await this.domainEventLogStore.list({
        limit: 1000,
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

    const result: StatisticsResponse = {
      from: params.from,
      to: params.to,
      granularity: params.granularity,
      summary: updatedSummary,
      timeSeries,
      agentLeaderboard,
      skillLeaderboard,
      panelLeaderboard,
    };

    // Cache for 60 seconds
    this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + 60_000 });

    return result;
  }

  private buildBuckets(
    from: Date,
    to: Date,
    granularity: 'day' | 'week' | 'month',
  ): Array<{ start: Date; end: Date; label: string }> {
    const buckets: Array<{ start: Date; end: Date; label: string }> = [];
    let current = new Date(from);

    while (current < to) {
      const start = new Date(current);
      let end: Date;
      let label: string;

      switch (granularity) {
        case 'day':
          end = new Date(current);
          end.setDate(end.getDate() + 1);
          label = start.toISOString().split('T')[0]!;
          break;
        case 'week':
          end = new Date(current);
          end.setDate(end.getDate() + 7);
          label = start.toISOString().split('T')[0]!;
          break;
        case 'month':
          end = new Date(current);
          end.setMonth(end.getMonth() + 1);
          label = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
          break;
      }

      if (end > to) end = new Date(to);
      buckets.push({ start, end, label });
      current = end;
    }

    return buckets;
  }
}

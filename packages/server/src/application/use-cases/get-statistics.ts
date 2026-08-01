import type { StatisticsResponse } from '@fleex/shared';
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
import type { LoggerPort } from '../ports/logger.port.js';
import {
  MOVE_EVENTS_FETCH_LIMIT,
  PANEL_EVENTS_FETCH_LIMIT,
  STATS_CACHE_TTL_MS,
} from '../utils/statistics/constants.js';
import { buildBuckets } from '../utils/statistics/buckets.js';
import { buildDataset, type RawStatsData } from '../utils/statistics/dataset.js';
import { sliceDataset } from '../utils/statistics/slice.js';
import { computeSummary } from '../utils/statistics/summary.js';
import { computeTimeSeries } from '../utils/statistics/time-series.js';
import {
  computeAgentLeaderboard,
  computePanelLeaderboard,
  computeSkillLeaderboard,
  computeWorkflowLeaderboard,
} from '../utils/statistics/leaderboards.js';
import { computeActivityHeatmap, computeUsageByType } from '../utils/statistics/activity.js';
import { computeFlowMetrics } from '../utils/statistics/flow-metrics.js';
import { computeCumulativeFlow } from '../utils/statistics/cumulative-flow.js';

interface CacheEntry {
  data: StatisticsResponse;
  expiresAt: number;
}

/** A persisted domain-event-log row, as returned by the store port. */
type LogEntry = Awaited<ReturnType<DomainEventLogStorePort['list']>>[number];

/**
 * Builds the statistics read model.
 *
 * The pipeline is load → materialise → slice → compute → assemble. Only this
 * class touches stores or the clock; every aggregate lives in
 * `utils/statistics/` as a pure function over plain rows.
 */
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
    /**
     * Optional so every existing call site keeps working unchanged; used only to
     * report silently truncated event fetches.
     */
    private readonly logger?: LoggerPort,
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
    const range = { fromMs: from.getTime(), toMs: to.getTime() };

    const dataset = buildDataset(await this.loadRawData(from, to));
    const buckets = buildBuckets(from, to, params.granularity);
    const slice = sliceDataset(dataset, buckets, range);

    const flow = computeFlowMetrics(dataset, range);
    const { cumulativeFlow, throughputWip } = computeCumulativeFlow(
      dataset.tickets,
      dataset.movesByTicket,
      buckets,
      { toMs: range.toMs, doneDates: flow.doneDates },
    );

    const result: StatisticsResponse = {
      from: params.from,
      to: params.to,
      granularity: params.granularity,
      summary: computeSummary(slice, dataset.sessions, {
        panelsExecuted: dataset.panelEvents.length,
        workflowsStarted: slice.workflowRuns.length,
      }),
      timeSeries: computeTimeSeries(slice, dataset.personaById),
      agentLeaderboard: computeAgentLeaderboard(slice.executions, dataset.personaById),
      skillLeaderboard: computeSkillLeaderboard(
        slice.executions.filter((e) => e.isSkill),
        dataset.skillById,
      ),
      panelLeaderboard: computePanelLeaderboard(dataset.panelEvents),
      workflowLeaderboard: computeWorkflowLeaderboard(slice.workflowRuns),
      usageByType: computeUsageByType(slice),
      activityHeatmap: computeActivityHeatmap(slice.executions, tzOffsetMinutes),
      ticketIterations: flow.ticketIterations,
      leadTime: flow.leadTime,
      cumulativeFlow,
      cycleTimeByStatus: flow.cycleTimeByStatus,
      throughputWip,
    };

    this.cache.set(cacheKey, { data: result, expiresAt: Date.now() + STATS_CACHE_TTL_MS });

    return result;
  }

  /**
   * Every read the response needs, issued concurrently.
   *
   * None of these depend on each other, so they used to be spread over four
   * sequential `await` points for no reason — which is also why the summary and
   * time series had to emit placeholder zeros for panels and workflows and patch
   * them in later.
   *
   * Moves are fetched with no lower bound so lead time and the CFD can see
   * transitions that happened before `from`.
   */
  private async loadRawData(from: Date, to: Date): Promise<RawStatsData> {
    const [
      tickets, boards, comments, mentions, deliverables, executions, personas, sessions,
      skills, panelEvents, moveEvents, workflowRuns,
    ] = await Promise.all([
      this.ticketStore.getAllTickets(),
      this.ticketStore.getAllBoards(),
      this.commentStore.getAll(),
      this.mentionStore.getAll(),
      this.deliverableStore.getAll(),
      this.agentEventStore.getAllExecutions(),
      this.personaStore.getAll(),
      this.sessionStore.getAll(),
      this.skillStore ? this.skillStore.getAll() : Promise.resolve([]),
      this.domainEventLogStore
        ? this.domainEventLogStore.list({
            limit: PANEL_EVENTS_FETCH_LIMIT,
            eventType: 'panel.executed',
            since: from,
            until: to,
          })
        : Promise.resolve([] as LogEntry[]),
      this.domainEventLogStore
        ? this.domainEventLogStore.list({
            limit: MOVE_EVENTS_FETCH_LIMIT,
            eventType: 'ticket.moved',
            until: to,
          })
        : Promise.resolve([] as LogEntry[]),
      this.workflowRunStore ? this.workflowRunStore.getAll() : Promise.resolve([]),
    ]);

    this.warnIfTruncated('panel.executed', panelEvents.length, PANEL_EVENTS_FETCH_LIMIT);
    this.warnIfTruncated('ticket.moved', moveEvents.length, MOVE_EVENTS_FETCH_LIMIT);

    return {
      tickets, boards, comments, mentions, deliverables, executions, personas, sessions,
      skills, panelEvents, moveEvents, workflowRuns,
    };
  }

  /**
   * A fetch that returns exactly its limit has almost certainly been cut short,
   * which silently understates every aggregate derived from it. Raising the
   * limit is a separate decision, so this only reports it.
   */
  private warnIfTruncated(eventType: string, received: number, limit: number): void {
    if (received < limit) return;
    this.logger?.warn('Statistics event fetch hit its limit; results may be incomplete', {
      eventType,
      limit,
    });
  }
}

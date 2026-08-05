export interface StatisticsTimeBucket {
  readonly date: string;
  readonly worktreesCreated: number;
  readonly prsCreated: number;
  readonly prsMerged: number;
  readonly agentsSpawned: number;
  readonly deliverablesCreated: number;
  readonly commentsCreated: number;
  readonly commentsCreatedByUser: number;
  readonly commentsCreatedByAgent: number;
  readonly mentionsCreated: number;
  readonly mentionsResolved: number;
  readonly ticketsCreated: number;
  readonly ticketsCompleted: number;
  readonly skillsExecuted: number;
  readonly panelsExecuted: number;
  readonly workflowsStarted: number;
  readonly totalCostUsd: number;
  readonly costByAgent: Record<string, number>; // personaName → costUsd
  /** Cost split by execution origin (agentic SDK vs manual CLI) for this bucket. */
  readonly costBySource: CostBySource;
  readonly ticketsDoneByBoard: Record<string, number>; // boardName → count of tickets moved to done in this bucket
}

/** Cost (USD) split by execution origin. */
export interface CostBySource {
  readonly sdk: number;
  readonly cli: number;
}

export interface AgentLeaderboardEntry {
  readonly personaId: string;
  readonly personaName: string;
  readonly personaDisplayName: string;
  readonly spawnCount: number;
  readonly avgDurationMs: number | null;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly totalCostUsd: number;
  readonly avgCostUsd: number | null;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly avgInputTokens: number | null;
  readonly avgOutputTokens: number | null;
}

export interface StatisticsSummary {
  readonly worktreesCreated: number;
  readonly prsCreated: number;
  readonly prsMerged: number;
  readonly agentsSpawned: number;
  readonly avgAgentDurationMs: number | null;
  readonly deliverablesCreated: number;
  readonly commentsCreated: number;
  readonly commentsCreatedByUser: number;
  readonly commentsCreatedByAgent: number;
  readonly mentionsCreated: number;
  readonly mentionsResolved: number;
  readonly ticketsCreated: number;
  readonly ticketsCompleted: number;
  readonly skillsExecuted: number;
  readonly panelsExecuted: number;
  readonly workflowsStarted: number;
  readonly activeSessions: number;
  readonly totalCostUsd: number;
  /** Global cost split by execution origin (agentic SDK vs manual CLI). */
  readonly totalCostBySource: CostBySource;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
}

/** Per-bucket counts of each execution mode, for the usage-trend chart (C13). */
export interface UsageByTypeBucket {
  readonly date: string;
  readonly agents: number;
  readonly skills: number;
  readonly panels: number;
  readonly workflows: number;
}

/** Single cell of the day-of-week × hour activity heatmap (C4). */
export interface ActivityHeatmapCell {
  readonly dow: number; // 0 = Sunday … 6 = Saturday
  readonly hour: number; // 0 … 23
  readonly count: number;
}

/** Interaction counts for one ticket completed in the period (C14). */
export interface TicketIterations {
  readonly ticketId: string;
  readonly title: string;
  readonly mentions: number;
  readonly comments: number;
  readonly agentRuns: number;
  readonly workflowRuns: number;
  /** comments + mentions + workflow runs — the "conversation length". */
  readonly total: number;
}

/** One ticket's first-doing → last-done lead time (C15 control chart). */
export interface LeadTimePoint {
  readonly ticketId: string;
  readonly title: string;
  readonly doneAt: string; // ISO timestamp of the last move to done
  readonly leadTimeMs: number;
}

export interface LeadTimeStats {
  readonly points: LeadTimePoint[];
  readonly avgMs: number | null;
  readonly medianMs: number | null;
  readonly p85Ms: number | null;
}

/** Count of tickets in each status at a bucket boundary (C16 CFD). */
export interface CumulativeFlowBucket {
  readonly date: string;
  readonly backlog: number;
  readonly todo: number;
  readonly doing: number;
  readonly reviewing: number;
  readonly done: number;
}

/** Average time tickets spent in a given status before moving on (C17). */
export interface CycleTimeStatus {
  readonly status: string;
  readonly avgMs: number | null;
  readonly count: number;
}

/** Throughput (tickets completed) vs work-in-progress per bucket (C18). */
export interface ThroughputWipBucket {
  readonly date: string;
  readonly completed: number;
  readonly wip: number;
}

export interface WorkflowLeaderboardEntry {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly workflowDisplayName: string;
  readonly executionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly avgDurationMs: number | null;
}

/**
 * Routine runs in range, grouped by routine. Distinct from the workflow board:
 * a routine may target a primitive (agent / skill / panel) and then has no
 * template at all, so its runs are invisible on every other leaderboard.
 */
export interface RoutineLeaderboardEntry {
  readonly routineId: string;
  readonly routineName: string;
  /** `workflow` / `agent` / `skill` / `panel` — what the routine launches. */
  readonly targetKind: string;
  readonly targetRef: string;
  readonly executionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly avgDurationMs: number | null;
  /** ISO instant of the most recent run in range, for a "last run" column. */
  readonly lastRunAt: string | null;
}

export interface StatisticsResponse {
  readonly from: string;
  readonly to: string;
  readonly granularity: 'day' | 'week' | 'month';
  readonly summary: StatisticsSummary;
  readonly timeSeries: StatisticsTimeBucket[];
  readonly agentLeaderboard: AgentLeaderboardEntry[];
  readonly skillLeaderboard: SkillLeaderboardEntry[];
  readonly panelLeaderboard: PanelLeaderboardEntry[];
  readonly workflowLeaderboard: WorkflowLeaderboardEntry[];
  readonly routineLeaderboard: RoutineLeaderboardEntry[];
  // ── Extended analytics (derived from existing data; no schema changes) ──
  readonly usageByType: UsageByTypeBucket[];
  readonly activityHeatmap: ActivityHeatmapCell[];
  readonly ticketIterations: TicketIterations[];
  readonly leadTime: LeadTimeStats;
  readonly cumulativeFlow: CumulativeFlowBucket[];
  readonly cycleTimeByStatus: CycleTimeStatus[];
  readonly throughputWip: ThroughputWipBucket[];
}

export interface SkillLeaderboardEntry {
  readonly skillId: string;
  readonly skillName: string;
  readonly skillDisplayName: string;
  readonly executionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
}

export interface PanelLeaderboardEntry {
  readonly panelId: string;
  readonly panelName: string;
  readonly panelDisplayName: string;
  readonly executionCount: number;
  readonly completedCount: number;
  readonly failedCount: number;
  readonly avgDurationMs: number | null;
  readonly avgRespondedMembers: number | null;
}

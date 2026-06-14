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
  readonly ticketsDoneByBoard: Record<string, number>; // boardName → count of tickets moved to done in this bucket
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

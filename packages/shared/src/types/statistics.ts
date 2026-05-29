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
  readonly totalCostUsd: number;
  readonly costByAgent: Record<string, number>; // personaName → costUsd
  // Token usage split by origin, so a stacked "agentic vs manual" chart can be drawn.
  readonly agenticInputTokens: number;
  readonly agenticOutputTokens: number;
  // Manual (human-driven Claude Code) sessions, kept separate from agentic usage.
  readonly manualSessionsCount: number;
  readonly manualInputTokens: number;
  readonly manualOutputTokens: number;
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
  readonly activeSessions: number;
  readonly totalCostUsd: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  // Manual (human-driven Claude Code) sessions, kept separate from agentic usage above.
  readonly manualSessionsCount: number;
  readonly manualInputTokens: number;
  readonly manualOutputTokens: number;
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

/** Token/cost rollup for one origin (auto or manual) on a single ticket. */
export interface TicketUsageBreakdown {
  readonly executionCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens: number;
  readonly cacheCreationTokens: number;
  /** USD is only known for agentic runs (SDK-reported); manual is always 0. */
  readonly costUsd: number;
}

/**
 * Per-ticket token usage, split auto (agent/skill/panel/workflow) vs manual.
 * Enables avg cost per ticket, manual-vs-auto ratio, and "full-auto" share.
 */
export interface TicketUsage {
  readonly ticketId: string;
  readonly auto: TicketUsageBreakdown;
  readonly manual: TicketUsageBreakdown;
  readonly total: TicketUsageBreakdown;
}

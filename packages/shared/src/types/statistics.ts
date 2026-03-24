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
}

export interface AgentLeaderboardEntry {
  readonly personaId: string;
  readonly personaName: string;
  readonly personaDisplayName: string;
  readonly spawnCount: number;
  readonly avgDurationMs: number | null;
  readonly completedCount: number;
  readonly failedCount: number;
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

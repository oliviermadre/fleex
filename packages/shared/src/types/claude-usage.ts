export interface ClaudeUsageMetric {
  readonly label: string;
  readonly percentage: number;
  readonly reset: string;
}

export interface ClaudeUsage {
  readonly session?: ClaudeUsageMetric;
  readonly weeklyAllModels?: ClaudeUsageMetric;
  readonly weeklySonnet?: ClaudeUsageMetric;
  readonly fetchedAt: string;
}

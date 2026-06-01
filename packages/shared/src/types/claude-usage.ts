export interface ClaudeUsageMetric {
  readonly label: string;
  /** Utilization of the quota, 0-100. */
  readonly percentage: number;
  /** ISO 8601 timestamp at which the quota window resets (empty if unknown). */
  readonly resetsAt: string;
}

export interface ClaudeUsage {
  readonly session?: ClaudeUsageMetric;
  readonly weeklyAllModels?: ClaudeUsageMetric;
  readonly weeklySonnet?: ClaudeUsageMetric;
  readonly fetchedAt: string;
}

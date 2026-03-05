export interface AppConfig {
  basePath: string;
  defaultShell: string;
  repositoryRefreshIntervalMs: number;
  humanDisplayName?: string;
  humanMentionName?: string;
  agentMaxConcurrency?: number;
  agentExecutionTimeout?: number;
}

export interface ConfigPort {
  get(): AppConfig;
  update(partial: Partial<AppConfig>): void | Promise<void>;
  getClaudeCommand(): string;
}

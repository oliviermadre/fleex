export interface AppConfig {
  basePath: string;
  defaultShell: string;
  repositoryRefreshIntervalMs: number;
  humanMentionName?: string;
}

export interface ConfigPort {
  get(): AppConfig;
  update(partial: Partial<AppConfig>): void | Promise<void>;
  getClaudeCommand(): string;
}

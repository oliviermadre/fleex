export interface AppConfig {
  repositoriesBasePath: string;
  defaultShell: string;
  claudeCommand: string;
  repositoryRefreshIntervalMs: number;
}

export interface ConfigPort {
  get(): AppConfig;
  update(partial: Partial<AppConfig>): void | Promise<void>;
}

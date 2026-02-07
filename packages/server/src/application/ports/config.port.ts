export interface AppConfig {
  repositoriesBasePath: string;
  defaultShell: string;
  claudeCommand: string;
}

export interface ConfigPort {
  get(): AppConfig;
  update(partial: Partial<AppConfig>): void;
}

import type { DeliverableTypeDef } from '@fleex/shared';

export interface RepoConfig {
  postCheckoutHook?: string; // multiline shell script, empty = disabled
  hookTimeoutSeconds?: number; // default 60
}

export interface AppConfig {
  basePath: string;
  defaultShell: string;
  repositoryRefreshIntervalMs: number;
  humanDisplayName?: string;
  humanMentionName?: string;
  agentMaxConcurrency?: number;
  agentExecutionTimeout?: number;
  repositories?: string[];
  resolvedRepositories?: string[];
  resolvedAt?: string;
  repoConfigs?: Record<string, RepoConfig>; // key = "org/name"
  /**
   * Per-workspace configurable deliverable types. Undefined/empty means use the
   * default preset (see DEFAULT_DELIVERABLE_TYPES in @fleex/shared).
   */
  deliverableTypes?: DeliverableTypeDef[];
}

export interface ConfigPort {
  init(): Promise<void>;
  get(): AppConfig;
  update(partial: Partial<AppConfig>): void | Promise<void>;
  getClaudeCommand(): string;
}

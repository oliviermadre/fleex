import type { DeliverableTypeDef } from '@fleex/shared';

/**
 * Default dead-letter ceiling for a mention's execution attempts. Three tries is
 * enough to ride out a transient failure (network, a busy API) without letting a
 * deterministic crash loop forever. See `docs/execution-recovery-policy.md`.
 */
export const DEFAULT_AGENT_MAX_ATTEMPTS = 3;

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
  /**
   * How many SDK executions a mention may start before it is dead-lettered and
   * needs an explicit "Force relaunch". Defaults to 3; `0` or negative disables
   * the cap so a bad config can never freeze an instance.
   * See `docs/execution-recovery-policy.md`.
   */
  agentMaxAttempts?: number;
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

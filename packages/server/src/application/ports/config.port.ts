import type { ActionDef, DeliverableTypeDef } from '@fleex/shared';

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
   * Agentic loop cap for plan/edit executions. Unset → DEFAULT_AGENT_MAX_TURNS.
   * Talk mode is unaffected (it has no agentic loop).
   */
  agentMaxTurns?: number;
  repositories?: string[];
  resolvedRepositories?: string[];
  resolvedAt?: string;
  repoConfigs?: Record<string, RepoConfig>; // key = "org/name"
  /**
   * Per-workspace configurable deliverable types. Undefined/empty means use the
   * default preset (see DEFAULT_DELIVERABLE_TYPES in @fleex/shared).
   */
  deliverableTypes?: DeliverableTypeDef[];
  /**
   * Declared action registry — the only thing `POST /api/actions/:id/run` can
   * execute. Supersedes the legacy `pinnedIcons` / `workspaceActions` arrays
   * (folded in by `migrateActionsConfig` when the config is loaded).
   */
  actions?: ActionDef[];
}

export interface ConfigPort {
  init(): Promise<void>;
  get(): AppConfig;
  update(partial: Partial<AppConfig>): void | Promise<void>;
  getClaudeCommand(): string;
}

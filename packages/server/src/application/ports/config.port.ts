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
   * Which strategy selects the context injected into agent prompts.
   *
   * `legacy` (the default, and what an unset value means) is the tag-overlap and
   * recency ranking over ticket summaries. `semantic` is the opt-in beta that
   * retrieves across the whole indexed corpus. Unset must keep behaving exactly
   * as before this setting existed — an instance that never opts in pays no
   * indexing cost and sees no change in what its agents receive.
   */
  memoryEngine?: 'legacy' | 'semantic';
  /** Character budget for injected memory snippets. Unset → engine default. */
  memoryInjectionCharBudget?: number;
  /**
   * Per-feature switches for everything built on top of retrieval.
   *
   * All of them require `memoryEngine: 'semantic'` — they have no meaning without
   * an index — so the effective state is the AND of the engine and the flag (see
   * `isMemoryFeatureEnabled`). Each defaults to enabled: opting into the engine
   * is already the deliberate choice, and a user who wants the retrieval but not,
   * say, duplicate detection can turn that one off rather than being asked to
   * opt in twice.
   */
  memoryFeatures?: MemoryFeatureFlags;
}

/**
 * Features that consume the retrieval index.
 *
 * Listed one by one rather than as a free-form record so that adding a feature
 * is a typed change: the Settings panel enumerates this shape, and a flag with
 * no UI — or a toggle with no feature behind it — fails to compile.
 */
export interface MemoryFeatureFlags {
  /** Semantic results in the command palette. */
  paletteSearch?: boolean;
  /** `memory ask` — retrieval plus one LLM call to synthesise a cited answer. */
  ask?: boolean;
  /** Prefer memory from the repository a ticket is attached to. */
  repoScope?: boolean;
  /** Warn about similar existing tickets before creating one. */
  duplicateDetection?: boolean;
  /** Rank human corrections of agent output above ordinary discussion. */
  humanFeedbackBoost?: boolean;
}

export const MEMORY_FEATURE_KEYS = [
  'paletteSearch',
  'ask',
  'repoScope',
  'duplicateDetection',
  'humanFeedbackBoost',
] as const satisfies ReadonlyArray<keyof MemoryFeatureFlags>;

/**
 * Whether a memory-dependent feature is live.
 *
 * The engine check is not a convenience — every one of these features reads the
 * index, so running any of them under the legacy engine would either fail or
 * quietly do nothing. Making the gate one function means no call site can forget
 * half of the condition.
 */
export function isMemoryFeatureEnabled(config: AppConfig, feature: keyof MemoryFeatureFlags): boolean {
  if (config.memoryEngine !== 'semantic') return false;
  return config.memoryFeatures?.[feature] !== false;
}

export interface ConfigPort {
  init(): Promise<void>;
  get(): AppConfig;
  update(partial: Partial<AppConfig>): void | Promise<void>;
  getClaudeCommand(): string;
}

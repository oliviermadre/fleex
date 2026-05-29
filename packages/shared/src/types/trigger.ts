/**
 * Triggers — persisted, user-configured launchers of agentic primitives.
 *
 * A Trigger is a configured Launcher: it decides WHEN something runs (its
 * schedule/kind) and WHAT runs (a target primitive). This first iteration
 * ships `kind: 'cron'` (time-based). The `kind` discriminator + `config`
 * JSON leave room for `'event'` / `'webhook'` launchers later without a
 * schema change.
 */

/** Extensible: 'event' | 'webhook' come later. */
export type TriggerKind = 'cron';

/** A cron trigger fires either on a cron expression or a fixed interval. */
export type TriggerScheduleKind = 'cron' | 'interval';

/** The four agentic primitives a trigger can launch. */
export type TriggerTargetType = 'agent' | 'skill' | 'panel' | 'workflow';

/** Execution mode ceiling for the launched primitive. */
export type TriggerMode = 'talk' | 'plan' | 'edit';

/** kind-specific configuration. For `cron`, the scheduling parameters. */
export interface TriggerCronConfig {
  scheduleKind: TriggerScheduleKind;
  /** Standard 5-field cron expression (when scheduleKind === 'cron'). */
  scheduleExpr?: string;
  /** Fixed interval in milliseconds (when scheduleKind === 'interval'). */
  intervalMs?: number;
  /** IANA timezone for cron evaluation (default 'UTC'). */
  timezone?: string;
}

export type TriggerConfig = TriggerCronConfig;

export interface Trigger {
  id: string;
  name: string;
  slug: string;
  emoji: string;
  description: string;
  kind: TriggerKind;
  config: TriggerConfig;
  /** Markdown "mission" surfaced as context to the launched run (heartbeat-style). */
  descriptionMd: string;
  targetType: TriggerTargetType;
  targetRef: string;
  mode: TriggerMode;
  enabled: boolean;
  /** When the next run is due (ISO). Null disables scheduling. */
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastStatus: TriggerRunStatus | null;
  createdAt: string;
  updatedAt: string;
}

export type TriggerRunStatus = 'running' | 'completed' | 'failed' | 'skipped';

/** The execution log of a single trigger firing — a trigger's "output". */
export interface TriggerRun {
  id: string;
  triggerId: string;
  scheduledFor: string;
  status: TriggerRunStatus;
  /** Set when the trigger launched a workflow. */
  workflowRunId: string | null;
  /** Set when the trigger launched an agent/skill/panel directly. */
  executionId: string | null;
  workspacePath: string | null;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface CreateTriggerInput {
  name: string;
  emoji?: string;
  description?: string;
  kind?: TriggerKind;
  config: TriggerConfig;
  descriptionMd?: string;
  targetType: TriggerTargetType;
  targetRef: string;
  mode?: TriggerMode;
  enabled?: boolean;
}

export interface UpdateTriggerInput {
  name?: string;
  emoji?: string;
  description?: string;
  config?: TriggerConfig;
  descriptionMd?: string;
  targetType?: TriggerTargetType;
  targetRef?: string;
  mode?: TriggerMode;
  enabled?: boolean;
}

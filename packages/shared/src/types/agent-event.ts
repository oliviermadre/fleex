export interface AgentExecution {
  readonly id: string;
  readonly personaId: string;
  /** Null for workflow-step executions that belong to a routine, not a ticket. */
  readonly ticketId: string | null;
  /** Set instead of `ticketId` when the execution came from a routine run. */
  readonly routineId?: string | null;
  readonly mentionId: string;
  readonly eventCount: number;
  readonly status: 'running' | 'completed' | 'failed' | 'interrupted';
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly lastEventAt: string | null;
  readonly sdkSessionId?: string | null;
  readonly model?: string | null;
  readonly effectiveMode?: string | null;
  /** Resolved reasoning effort that actually ran (if the model supports it). */
  readonly effort?: string | null;
  /** Whether fast/low-latency mode actually ran (if the model supports it). */
  readonly fast?: boolean | null;
  readonly durationMs?: number | null;
  readonly costUsd?: number | null;
  readonly inputTokens?: number | null;
  readonly outputTokens?: number | null;
  readonly cacheReadTokens?: number | null;
  readonly cacheCreationTokens?: number | null;
  /**
   * Origin of the execution. `sdk` = Fleex agentic run (default; NULL is read as
   * `sdk`). `cli` = a manual `claude` CLI session in a ticket worktree, ingested
   * from its transcript. Lets stats break cost down by agentic vs manual usage.
   */
  readonly source?: 'sdk' | 'cli' | null;
  /**
   * The comment this run produced, if any. Explicit link (added in migration 024)
   * so the UI can pair a comment with its deliverable without pattern-matching on
   * `agentName`. NULL for runs that produced no comment or predate the migration.
   */
  readonly commentId?: string | null;
  /**
   * The deliverable this run produced, if any. Same rationale as `commentId`:
   * lets the Comments tab surface a deliverable chip (incl. the Human Gate one)
   * from a first-class link rather than a heuristic.
   */
  readonly deliverableId?: string | null;
}

export type AgentEventType =
  | 'message_start'
  | 'content_block_start'
  | 'content_block_delta'
  | 'content_block_stop'
  | 'message_delta'
  | 'message_stop'
  | 'turn_start'
  | 'turn_end'
  | 'execution_start'
  | 'execution_end'
  | 'execution_retry'
  /**
   * The SDK stopped the agentic loop because the configured turn budget was
   * exhausted (`result` subtype `error_max_turns`). Emitted so a truncated run
   * is unmistakable in the log instead of looking like a normal completion.
   */
  | 'max_turns_reached'
  | 'error';

/**
 * Discriminates what kind of run produced an `execution_start` event. Lets the
 * Execution Log header label an atomic execution at a glance (panel member,
 * orchestrator, workflow step, skill, …) even though they all stream the same
 * underlying SDK events.
 */
export type ExecutionKind =
  | 'persona'
  | 'skill'
  | 'panel_member'
  | 'panel_orchestrator'
  | 'workflow_step';

/** Observability context window summary surfaced in the execution header. */
export interface ExecutionStartContext {
  readonly systemPromptSections: string[];
  readonly systemPromptLength: number;
  readonly userPromptLength: number;
  /** Undefined for a routine-anchored run — there is no ticket to describe. */
  readonly ticketTitle?: string;
  readonly ticketStatus?: string;
  readonly commentsCount: number;
  readonly deliverablesCount: number;
}

/**
 * Payload of the `execution_start` agent event. Produced by a single shared
 * builder (`buildExecutionStartData`) so every execution kind — persona, skill,
 * panel member, panel orchestrator, workflow step — emits an identically rich
 * header (mode badge + ticket + context window summary).
 */
export interface ExecutionStartData {
  readonly executionId: string;
  readonly personaId: string;
  readonly personaName: string;
  /** Null for a routine-anchored run (no ticket). */
  readonly ticketId: string | null;
  readonly mentionId?: string;
  readonly model: string;
  readonly effectiveMode?: string;
  readonly worktreePath?: string | null;
  readonly resumeSessionId?: string | null;
  readonly kind: ExecutionKind;
  /** Human-friendly label (skill name, "orchestrateur", "workflow step", …). */
  readonly label?: string;
  readonly skillId?: string;
  readonly skillName?: string;
  /**
   * Turn budget handed to the SDK for this run (Settings › General → Max Agent
   * Turns), after clamping. Surfaced in the header so the log shows the budget
   * up front instead of leaving it to be inferred from tool-call counts.
   * Undefined for runs whose mode ignores the setting (talk) or for events
   * emitted before this field existed.
   */
  readonly maxTurns?: number;
  readonly context: ExecutionStartContext;
}

export interface AgentEvent {
  readonly id: string;
  readonly executionId: string;
  readonly eventType: AgentEventType;
  readonly data: unknown;
  readonly sequence: number;
  readonly createdAt: string;
}

/** One member of an aggregated panel run */
export interface PanelMemberSummary {
  readonly executionId: string;
  readonly personaId: string;
  readonly displayName: string;
  readonly initials: string;
  /**
   * 'pending' means the member has not started yet (used for the orchestrator
   * bubble that we surface before its execution record exists). Otherwise
   * mirrors AgentExecution['status'].
   */
  readonly status: 'pending' | 'running' | 'completed' | 'failed' | 'interrupted';
  readonly isOrchestrator: boolean;
}

/**
 * One step in a workflow run, summarised for the Execution Log dots row.
 * `status` mirrors `StepRunStatus` from `workflow.ts` but is kept as a string
 * here to avoid cross-imports.
 */
export interface WorkflowStepSummary {
  readonly stepId: string;
  readonly name: string;
  readonly status:
    | 'pending' | 'queued' | 'running' | 'completed'
    | 'failed' | 'needs_review' | 'awaiting_routing' | 'cancelled' | 'skipped';
  readonly isCurrent: boolean;
}

/** Enriched execution entry for the Execution Log view */
export interface ExecutionLogEntry extends AgentExecution {
  readonly type: 'agent' | 'panel' | 'skill' | 'workflow';
  readonly executorName: string;
  readonly ticketTitle: string | null;
  readonly ticketSlug: string | null;
  readonly ticketPriority: string | null;
  readonly ticketType: string | null;
  readonly commentCount: number;
  readonly deliverableCount: number;
  /** Only set for skill executions: the agent that hosted the skill run. */
  readonly runByName?: string;
  /** Only set for aggregated panel runs (type === 'panel' with multiple members). */
  readonly panelDisplayName?: string;
  readonly panelMembers?: PanelMemberSummary[];
  readonly memberCount?: number;
  /**
   * Workflow-specific fields. Only set for type === 'workflow'.
   * `workflowSubStatus` carries the `needs_review` / `blocked` nuance that
   * doesn't fit `AgentExecution['status']` (which is the broader running/completed/...),
   * so the UI can show a distinct "Needs Review" badge.
   */
  readonly workflowRunId?: string;
  readonly workflowSubStatus?: 'needs_review' | 'blocked';
  readonly workflowCurrentStepName?: string;
  readonly workflowStepProgress?: WorkflowStepSummary[];
  /** Number of steps completed (status === 'completed') in this run. */
  readonly workflowCompletedSteps?: number;
  /** Total number of steps in the run's snapshot. */
  readonly workflowTotalSteps?: number;
  /**
   * Routine chip, shown where a ticket-bound execution shows its ticket chip.
   * Set iff the execution belongs to a routine run (`ticketId` is then null).
   */
  readonly routineName?: string | null;
  readonly routineEmoji?: string | null;
  readonly routineSlug?: string | null;
}

/**
 * Derive 1–2 letter initials from a display name. "Security Nerd" → "SN";
 * "Builder" → "BU". Returns "?" for empty input.
 */
export function computeInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return (words[0]![0]! + words[1]![0]!).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

/**
 * What a run is anchored to. Orthogonal to `ExecutionLogEntry['type']` (which
 * says *what executed*): a workflow run can be anchored to a ticket or to a
 * routine, and the two need very different affordances — a routine run has no
 * ticket, so no comments/deliverables/ticket CTAs.
 */
export type ExecutionScope = 'tickets' | 'routines';

export interface ExecutionLogResponse {
  readonly entries: ExecutionLogEntry[];
  readonly total: number;
  readonly liveCount: number;
  readonly historyCount: number;
  readonly typeCounts: {
    readonly all: number;
    readonly agent: number;
    readonly panel: number;
    readonly skill: number;
    readonly workflow: number;
  };
  readonly scopeCounts: {
    readonly all: number;
    readonly tickets: number;
    readonly routines: number;
  };
}

export type AgentEventWsMessageType =
  | 'agent_event:delta'
  | 'agent_event:batch'
  | 'agent_event:execution_start'
  | 'agent_event:execution_end';

export interface AgentEventWsMessage {
  readonly type: AgentEventWsMessageType;
  readonly executionId: string;
  readonly ticketId: string;
  readonly data: AgentEvent | AgentEvent[] | AgentExecution;
}

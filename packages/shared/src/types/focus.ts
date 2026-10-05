import type { AgentQuestion } from './ticket.js';

// ── Focus (human-attention queue) ──

/**
 * Why a Doing/Reviewing ticket sits in the Focus list — i.e. what a human owes
 * it. One item per ticket, the most actionable reason winning:
 *
 * - `gate`: a workflow run is parked on a `human_gate` step (pick an outcome),
 *   or on an ambiguous route (pick the edge to take).
 * - `question`: an agent asked something — a mention in `waiting_for_info`, or
 *   a non-gate workflow step paused in `needs_review` with a question — or a
 *   Claude Code CLI session waits on a permission / a structured question
 *   (set client-side from the live hook status, see `web/…/focusSessions.ts`).
 * - `error`: the latest workflow run has a failed step awaiting a Retry, or an
 *   agent session crashed (mention `failed`).
 * - `idle`: nothing is running, queued or waiting on the ticket.
 */
export type FocusItemKind = 'gate' | 'question' | 'error' | 'idle';

/** Precedence when a ticket qualifies for several kinds (lower wins). */
export const FOCUS_KIND_ORDER: Record<FocusItemKind, number> = { gate: 0, question: 1, error: 2, idle: 3 };

/** One choice offered by a gate. */
export interface FocusGateOption {
  /**
   * What to send back: the outcome string for a human gate, the edge id for an
   * ambiguous route.
   */
  readonly value: string;
  /** Button label. */
  readonly label: string;
  /** Name of the step the choice leads to, when it can be told from the edges. */
  readonly targetStepName: string | null;
}

/** A step of the run's template, laid out in execution order, for the pipeline strip. */
export interface FocusPipelineStep {
  readonly id: string;
  readonly name: string;
  readonly state: 'done' | 'current' | 'todo';
  readonly isGate: boolean;
}

export interface FocusWorkflowRef {
  readonly runId: string;
  readonly name: string;
  readonly emoji: string;
  readonly steps: FocusPipelineStep[];
}

export interface FocusGate {
  readonly runId: string;
  readonly stepRunId: string;
  readonly stepName: string;
  /** `outcome` → resolve the human gate; `route` → pick the edge of an ambiguous route. */
  readonly mode: 'outcome' | 'route';
  readonly options: FocusGateOption[];
  /** Comment left by the step that led to the gate, when any. */
  readonly context: string | null;
}

export interface FocusQuestion {
  /**
   * `mention` → answer with a ticket comment (wakes the agent); `step` → comment + retry the step;
   * `session` → a CLI session waits in its terminal: the answer is given there.
   */
  readonly source: 'mention' | 'step' | 'session';
  readonly mentionId: string | null;
  readonly runId: string | null;
  readonly stepRunId: string | null;
  /** Display name of whoever asked (persona, or workflow step). */
  readonly askedBy: string | null;
  /** The question itself — the agent's last comment, or the paused step's comment. */
  readonly text: string | null;
  /** Closed questions the agent declared, when any — the source of answer buttons. */
  readonly questions?: AgentQuestion[] | null;
  /** `session` only: the waiting terminal, to open it. */
  readonly sessionId?: string;
  /** `session` only: what the session waits for. */
  readonly sessionWait?: 'permission' | 'question';
}

export interface FocusError {
  /** `step` → retry the failed workflow step; `mention` → relaunch the crashed session. */
  readonly source: 'step' | 'mention';
  readonly runId: string | null;
  readonly stepRunId: string | null;
  readonly mentionId: string | null;
  /** Failed step name, or the agent whose session crashed. */
  readonly label: string;
  readonly message: string | null;
  /** The failed execution, to open its logs. */
  readonly executionId: string | null;
}

export interface FocusIdle {
  /** Last SDK activity on the ticket; null when no agent ever ran on it. */
  readonly lastActivityAt: string | null;
  /** The agent that worked on the ticket last — the one "Relancer" wakes. */
  readonly lastAgentName: string | null;
  readonly lastAgentDisplayName: string | null;
  /**
   * When a Claude Code CLI session on the ticket last went to rest (turn done,
   * awaiting instruction, exited). Set client-side from the live hook status.
   */
  readonly cliRestAt?: string | null;
  /** The resting CLI session, to open it. */
  readonly cliSessionId?: string;
}

export interface FocusItem {
  /**
   * Stable identity of the *reason*, not the ticket: `gate:<stepRunId>`,
   * `question:<mentionId|stepRunId>`, `error:<stepRunId|mentionId>`,
   * `idle:<ticketId>:<status>`, `session:<sessionId>:<since>` (client-side). A
   * snooze keyed on it lapses once the reason changes.
   */
  readonly key: string;
  readonly kind: FocusItemKind;
  readonly ticketId: string;
  /** When the ticket started waiting for the human (ISO); null when unknown. */
  readonly since: string | null;
  readonly workflow: FocusWorkflowRef | null;
  readonly gate: FocusGate | null;
  readonly question: FocusQuestion | null;
  readonly error: FocusError | null;
  readonly idle: FocusIdle | null;
  /** Latest agent comment on the ticket, for the detail popup. */
  readonly lastAgentComment: { readonly authorName: string; readonly body: string; readonly createdAt: string } | null;
  /** Cumulative agentic cost of the ticket, USD. */
  readonly costUsd: number;
}

/**
 * A Doing/Reviewing ticket being worked on autonomously right now, with nothing
 * asked of the human — the "en cours" recap under the Focus list.
 */
export interface FocusRunning {
  readonly ticketId: string;
  /**
   * `workflow` → a run executes a step · `agent` → an SDK agent session runs ·
   * `queued` → an agent mention waits for its turn · `cli` → a Claude Code
   * terminal session works (set client-side from the live hook status).
   */
  readonly source: 'workflow' | 'agent' | 'queued' | 'cli';
  /** Who is on it: the step name, or the agent's display name. */
  readonly label: string;
  /** When this stretch of work started (ISO); null when unknown. */
  readonly since: string | null;
  /** The live execution, to follow its logs. */
  readonly executionId: string | null;
  readonly workflow: FocusWorkflowRef | null;
  /** `cli` only: the working terminal, to open it. */
  readonly sessionId?: string;
  /** Cumulative agentic cost of the ticket, USD. */
  readonly costUsd: number;
}

export interface FocusResponse {
  readonly items: FocusItem[];
  /** Tickets in Doing/Reviewing an agent is working on, nothing waiting on the human. */
  readonly running: FocusRunning[];
}

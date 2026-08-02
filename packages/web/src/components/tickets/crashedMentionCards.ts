import type { TicketMention, MentionFailureReason } from '@fleex/shared';

/**
 * Inline "the last agent run ended badly — relaunch?" card, surfaced in the
 * Comments thread. A pure selector feeds a tinted card + a relaunch action.
 *
 * Source of truth is the PERSISTED mention (`status: 'failed'` +
 * `failureReason`), not the ephemeral `mention:execution_failed` event: the
 * event is gone after a reload, and the ticket requires a timed-out agent to
 * still show its reason. The live event is only an accelerator, used before the
 * companion `mention:updated` lands.
 *
 * All user-facing copy lives here, in English, like the rest of the UI. The
 * server only ever emits reason codes — see `docs/execution-recovery-policy.md`.
 */
export interface CrashedMentionCard {
  mention: TicketMention;
  reason: MentionFailureReason;
  /** Short headline for the cause. */
  label: string;
  /** What the user can do about it. */
  remediation: string;
  /**
   * `neutral` for a run the user stopped themselves — an alert-red card for a
   * deliberate Terminate would read as "something broke", which it did not.
   */
  tone: 'error' | 'neutral';
  /** Raw technical text (stderr excerpt, SDK error), when the server had one. */
  detail: string | null;
  attemptCount: number;
  /** Configured ceiling; `0` means no cap is advertised on this surface. */
  maxAttempts: number;
  /** Budget spent: only a confirmed Force relaunch may run this mention again. */
  exhausted: boolean;
}

interface ReasonCopy {
  label: string;
  remediation: string;
  tone: 'error' | 'neutral';
}

/** Label + remediation per reason code emitted by the server. */
export const CRASH_REASON_COPY: Record<MentionFailureReason, ReasonCopy> = {
  usage_limit: {
    label: 'Usage limit reached',
    remediation: 'Your Claude plan is out of credits or rate-limited. Switch account or wait for the quota to reset, then relaunch.',
    tone: 'error',
  },
  not_authenticated: {
    label: 'Not signed in to Claude Code',
    remediation: 'Run `claude login` on the Fleex host, then relaunch.',
    tone: 'error',
  },
  billing: {
    label: 'Billing issue',
    remediation: 'Claude rejected the request for a billing reason. Check your plan or API credits, then relaunch.',
    tone: 'error',
  },
  invalid_request: {
    label: 'Invalid request',
    remediation: 'Claude rejected the request. Check the model and execution mode for this agent, then relaunch.',
    tone: 'error',
  },
  server_error: {
    label: 'Claude API error',
    remediation: "Claude's API returned an error. This is usually transient — relaunch in a few minutes.",
    tone: 'error',
  },
  max_turns: {
    label: 'Turn limit reached',
    remediation: 'The agent hit the turn limit. Relaunch to resume the session where it stopped.',
    tone: 'error',
  },
  max_output_tokens: {
    label: 'Output too long',
    remediation: 'The model hit its output limit. Relaunch to resume, or narrow the ask.',
    tone: 'error',
  },
  max_budget: {
    label: 'Cost budget reached',
    remediation: 'The run hit its configured USD budget. Raise the budget or relaunch to resume.',
    tone: 'error',
  },
  output_format: {
    label: 'Invalid structured output',
    remediation: 'The agent could not produce valid structured output. Relaunch, or simplify the expected deliverable.',
    tone: 'error',
  },
  subprocess: {
    label: 'Session crashed',
    remediation: 'The Claude CLI stopped unexpectedly. Check the logs, then relaunch.',
    tone: 'error',
  },
  timeout: {
    label: 'Timed out',
    remediation: 'The run exceeded the execution timeout and was stopped. Relaunch to resume, or raise the timeout in Settings.',
    tone: 'error',
  },
  cancelled: {
    label: 'Stopped',
    remediation: 'You stopped this run. Relaunch to resume where it left off.',
    tone: 'neutral',
  },
  server_restart: {
    label: 'Interrupted by a server restart',
    remediation: 'Fleex restarted while this agent was running. Relaunch to resume the session.',
    tone: 'neutral',
  },
  startup_error: {
    label: 'Failed to start',
    remediation: 'The agent never started. See the technical details, then relaunch.',
    tone: 'error',
  },
  unknown: {
    label: 'Session interrupted',
    remediation: 'The run ended unexpectedly. Check the logs, then relaunch.',
    tone: 'error',
  },
};

/** Copy for a mention that burned its attempt budget. */
export const ATTEMPTS_EXHAUSTED_REMEDIATION =
  'This mention failed too many times in a row. Fix the underlying cause before forcing another run.';

/**
 * Budget spent: the server refuses a plain relaunch (409) and only a `force`
 * run gets through. Every surface offering a relaunch must ask this first, so
 * the user sees the confirmation instead of an opaque rejection.
 *
 * `maxAttempts === 0` means no ceiling is advertised — never dead-letter on it.
 */
export function isMentionExhausted(m: Pick<TicketMention, 'attemptCount' | 'maxAttempts'>): boolean {
  const maxAttempts = m.maxAttempts ?? 0;
  return maxAttempts > 0 && (m.attemptCount ?? 0) >= maxAttempts;
}

export function crashReasonCopy(reason: string): ReasonCopy {
  return CRASH_REASON_COPY[reason as MentionFailureReason] ?? CRASH_REASON_COPY.unknown;
}

export function crashReasonLabel(reason: string): string {
  return crashReasonCopy(reason).label;
}

/** Live crash signal from the `mention:execution_failed` WS event. */
export interface LiveFailure {
  reason: string;
  detail?: string;
  attemptCount?: number;
  maxAttempts?: number;
}

/**
 * One card per agent mention currently in `failed`. Human/panel/skill targets
 * never run an SDK session, so only `agent` mentions can crash and get a card.
 *
 * The persisted `failureReason` wins over the live event: it is the value that
 * survives a reload, and after a relaunch it is the one that gets cleared.
 */
export function selectCrashedMentionCards(
  mentions: TicketMention[],
  failures: Record<string, LiveFailure>,
): CrashedMentionCard[] {
  return mentions
    .filter((m) => m.status === 'failed' && m.targetType === 'agent')
    .map((m) => {
      const live = failures[m.id];
      const reason = (m.failureReason ?? live?.reason ?? 'unknown') as MentionFailureReason;
      const copy = crashReasonCopy(reason);
      const attemptCount = m.attemptCount ?? live?.attemptCount ?? 0;
      const maxAttempts = m.maxAttempts || live?.maxAttempts || 0;
      return {
        mention: m,
        reason,
        label: copy.label,
        remediation: copy.remediation,
        tone: copy.tone,
        detail: m.failureDetail ?? live?.detail ?? null,
        attemptCount,
        maxAttempts,
        exhausted: isMentionExhausted({ attemptCount, maxAttempts }),
      };
    });
}

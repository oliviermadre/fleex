import type { MentionFailureReason } from '@fleex/shared';

/**
 * Taxonomy of agent-execution failures — see `docs/execution-recovery-policy.md`.
 *
 * Produces a stable machine `reason` plus the *raw* technical `detail`. It never
 * produces user-facing copy: labels and remediations live in the web client
 * (`crashedMentionCards.ts`), in English, like the rest of the UI.
 */
export interface CrashClassification {
  reason: MentionFailureReason;
  /** Raw technical text (SDK error, stderr excerpt). Undefined when there is none. */
  detail?: string;
}

export interface ClassifyCrashInput {
  /** A policy decision Fleex already made — always wins. */
  explicit?: MentionFailureReason;
  /** `SDKAssistantMessage.error`, a structured SDK code. */
  assistantError?: string | null;
  /** `SDKResultError.subtype`, a structured SDK result code. */
  resultSubtype?: string | null;
  /** Free-form error text, for errors *thrown* by the CLI (no code available). */
  raw?: string | null;
  /** False when the mention never reached `acknowledged` (the run never started). */
  acknowledged: boolean;
}

/**
 * `SDKAssistantMessageError` → our reason. `unknown` is deliberately absent: the
 * SDK's own "unknown" carries no information and must not shadow a classifiable
 * raw message. Unrecognised members degrade the same way.
 */
const ASSISTANT_ERROR_REASONS: Record<string, MentionFailureReason> = {
  authentication_failed: 'not_authenticated',
  // Not listed in the ticket but present in the installed SDK: an org that
  // disallows this OAuth app is an auth problem with the same remediation.
  oauth_org_not_allowed: 'not_authenticated',
  billing_error: 'billing',
  rate_limit: 'usage_limit',
  invalid_request: 'invalid_request',
  server_error: 'server_error',
  max_output_tokens: 'max_output_tokens',
};

/**
 * `SDKResultError.subtype` → our reason. `error_during_execution` is absent on
 * purpose: it is a wrapper, not a cause, and mapping it would hide the real
 * error text underneath.
 */
const RESULT_SUBTYPE_REASONS: Record<string, MentionFailureReason> = {
  error_max_turns: 'max_turns',
  error_max_budget_usd: 'max_budget',
  error_max_structured_output_retries: 'output_format',
};

const USAGE_LIMIT = /usage limit|monthly limit|hit your .*limit|out of credits?|insufficient .*credit|quota (?:exceeded|exhausted)|rate.?limit/i;
const NOT_AUTH = /not logged in|claude login|not authenticated|unauthorized|invalid api key|authentication_error|\b401\b/i;
const MAX_TURNS = /max(?:imum)?[ _-]?turns|error_max_turns/i;

/**
 * Classification order (most trustworthy signal first):
 *
 * 1. `explicit` — a policy decision (timeout, cancel, restart, silent subprocess).
 * 2. `assistantError` — a structured SDK code.
 * 3. `resultSubtype` — a structured SDK result code.
 * 4. Regex over the raw text — last resort, for errors thrown by the CLI.
 * 5. `startup_error` (pre-acknowledge) or `unknown`.
 */
export function classifyCrash(input: ClassifyCrashInput): CrashClassification {
  const text = (input.raw ?? '').trim();
  const detail = text || undefined;

  if (input.explicit) return { reason: input.explicit, detail };

  const fromAssistant = input.assistantError
    ? ASSISTANT_ERROR_REASONS[input.assistantError]
    : undefined;
  if (fromAssistant) return { reason: fromAssistant, detail };

  const fromSubtype = input.resultSubtype
    ? RESULT_SUBTYPE_REASONS[input.resultSubtype]
    : undefined;
  if (fromSubtype) return { reason: fromSubtype, detail };

  if (USAGE_LIMIT.test(text)) return { reason: 'usage_limit', detail };
  if (NOT_AUTH.test(text)) return { reason: 'not_authenticated', detail };
  if (MAX_TURNS.test(text)) return { reason: 'max_turns', detail };

  return { reason: input.acknowledged ? 'unknown' : 'startup_error', detail };
}

/**
 * Best-effort taxonomy of agent-session crashes (ticket #443). Maps a raw error
 * message / SDK signal onto a stable `reason` code + a human-readable remediation
 * `message` that the crash card and the `mention:execution_failed` toast surface
 * verbatim. Classification is intentionally lenient (substring/regex matching):
 * the SDK does not expose structured error codes for these cases, and a wrong
 * guess still degrades gracefully to the generic `unknown`/`startup_error` copy.
 */
export interface CrashClassification {
  /** Stable machine code, one of the taxonomy keys below. */
  reason: string;
  /** Human-readable remediation, shown verbatim in the UI. */
  message: string;
}

/**
 * Remediation copy per reason code. Kept as a single source of truth so the
 * `error_max_turns` result-subtype path (which never throws) can reuse the same
 * wording as the thrown-error path.
 */
export const CRASH_MESSAGES: Record<string, string> = {
  usage_limit:
    "Quota d'usage épuisé. Changez de compte Claude ou ajoutez des crédits, puis relancez.",
  not_authenticated: 'Non authentifié à Claude Code. Faites `claude login` puis relancez.',
  max_turns: 'Limite de tours atteinte. Relancez pour continuer (reprise de session).',
  subprocess: "La session s'est interrompue. Consultez les logs, puis relancez.",
  startup_error: 'Agent failed to start',
  unknown: "La session s'est interrompue. Consultez les logs, puis relancez.",
};

const USAGE_LIMIT =
  /usage limit|monthly limit|hit your .*limit|out of credits?|insufficient .*credit|quota (?:exceeded|exhausted)/i;
const NOT_AUTH =
  /not logged in|claude login|not authenticated|unauthorized|invalid api key|authentication_error|\b401\b/i;
const MAX_TURNS = /max(?:imum)?[ _-]?turns|error_max_turns/i;

/**
 * Classify a crash from its raw error text. `acknowledged` distinguishes a
 * startup failure (mention never reached `acknowledged`) — which keeps the
 * historical `startup_error` reason and echoes the raw message — from an
 * in-run crash, which falls back to `unknown` with generic remediation.
 */
export function classifyCrash(raw: string, opts: { acknowledged: boolean }): CrashClassification {
  const text = (raw ?? '').trim();

  if (USAGE_LIMIT.test(text))
    return { reason: 'usage_limit', message: CRASH_MESSAGES.usage_limit! };
  if (NOT_AUTH.test(text))
    return { reason: 'not_authenticated', message: CRASH_MESSAGES.not_authenticated! };
  if (MAX_TURNS.test(text)) return { reason: 'max_turns', message: CRASH_MESSAGES.max_turns! };

  if (!opts.acknowledged) {
    return { reason: 'startup_error', message: text || CRASH_MESSAGES.startup_error! };
  }
  return { reason: 'unknown', message: text || CRASH_MESSAGES.unknown! };
}

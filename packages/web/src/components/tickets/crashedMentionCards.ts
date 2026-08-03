import type { TicketMention } from '@fleex/shared';

/**
 * Inline "the last Claude session crashed — relaunch?" card, surfaced in the
 * Comments thread (ticket #443). Mirrors the waiting-input card pattern: a pure
 * selector feeds a red-tinted card + a one-click "Relancer" action.
 *
 * Presence is driven by the persisted mention status (`failed`), so the card
 * survives a reload. The `reason`/`message` come from the live
 * `mention:execution_failed` event (`failures` map); on a cold reload — when
 * that ephemeral event is gone — we fall back to a generic remediation and rely
 * on the "Voir les logs" link for the precise cause.
 */
export interface CrashedMentionCard {
  mention: TicketMention;
  reason: string;
  message: string;
}

/** Short human label per crash reason code (see server `classify-crash.ts`). */
export const CRASH_REASON_LABELS: Record<string, string> = {
  usage_limit: "Quota d'usage épuisé",
  not_authenticated: 'Non authentifié à Claude Code',
  max_turns: 'Limite de tours atteinte',
  subprocess: 'Session interrompue',
  startup_error: 'Échec du démarrage',
  unknown: 'Session interrompue',
};

/** Generic remediation shown when the live crash reason is no longer available. */
export const CRASH_FALLBACK_MESSAGE =
  "La session s'est interrompue. Consultez les logs, puis relancez.";

export function crashReasonLabel(reason: string): string {
  return CRASH_REASON_LABELS[reason] ?? 'Session interrompue';
}

/**
 * One card per agent mention currently in `failed`. Human/panel/skill targets
 * never run an SDK session, so only `agent` mentions can crash and get a card.
 */
export function selectCrashedMentionCards(
  mentions: TicketMention[],
  failures: Record<string, { reason: string; message: string }>,
): CrashedMentionCard[] {
  return mentions
    .filter((m) => m.status === 'failed' && m.targetType === 'agent')
    .map((m) => {
      const f = failures[m.id];
      return {
        mention: m,
        reason: f?.reason ?? 'unknown',
        message: f?.message ?? CRASH_FALLBACK_MESSAGE,
      };
    });
}

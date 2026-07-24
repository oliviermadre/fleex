import { describe, it, expect } from 'vitest';
import type { TicketMention, MentionStatus, MentionTargetType } from '@fleex/shared';
import { selectCrashedMentionCards, CRASH_FALLBACK_MESSAGE, crashReasonLabel } from './crashedMentionCards';

function mention(
  id: string,
  status: MentionStatus,
  targetType: MentionTargetType = 'agent',
): TicketMention {
  return {
    id,
    ticketId: 't1',
    commentId: `c-${id}`,
    targetAgent: 'builder',
    sourceAgent: 'user',
    targetType,
    executionMode: 'edit',
    status,
    resolvedAt: null,
    resolvedCommentId: null,
    resolvedDeliverableId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('selectCrashedMentionCards', () => {
  it('returns [] when no mention has failed', () => {
    const mentions = [mention('a', 'pending'), mention('b', 'acknowledged'), mention('c', 'resolved')];
    expect(selectCrashedMentionCards(mentions, {})).toEqual([]);
  });

  // WHY: the card is what tells the user a crash happened at all — it must appear
  // for every failed agent mention, carrying the live reason/message when known.
  it('surfaces a card for a failed agent mention with its live reason/message', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed')],
      { a: { reason: 'usage_limit', message: 'Quota épuisé.' } },
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.mention.id).toBe('a');
    expect(cards[0]!.reason).toBe('usage_limit');
    expect(cards[0]!.message).toBe('Quota épuisé.');
  });

  // WHY: after a cold reload the ephemeral crash event is gone but the mention is
  // still persisted as `failed`. The card MUST still render (with fallback copy),
  // otherwise the crash becomes invisible again — the exact bug we're fixing.
  it('renders a failed mention with fallback copy when the live reason is unknown', () => {
    const cards = selectCrashedMentionCards([mention('a', 'failed')], {});
    expect(cards).toHaveLength(1);
    expect(cards[0]!.reason).toBe('unknown');
    expect(cards[0]!.message).toBe(CRASH_FALLBACK_MESSAGE);
  });

  // WHY: only SDK-backed agent mentions can crash; a human/panel/skill mention in
  // an odd state must never masquerade as a crashed agent session.
  it('never surfaces a card for a non-agent target', () => {
    const cards = selectCrashedMentionCards(
      [mention('h', 'failed', 'human'), mention('p', 'failed', 'panel')],
      {},
    );
    expect(cards).toEqual([]);
  });

  it('maps reason codes to human labels, falling back for unknown codes', () => {
    expect(crashReasonLabel('usage_limit')).toBe("Quota d'usage épuisé");
    expect(crashReasonLabel('max_turns')).toBe('Limite de tours atteinte');
    expect(crashReasonLabel('some_new_code')).toBe('Session interrompue');
  });
});

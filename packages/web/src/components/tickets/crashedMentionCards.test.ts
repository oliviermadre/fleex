import { describe, it, expect } from 'vitest';
import type { TicketMention, MentionStatus, MentionTargetType, MentionFailureReason } from '@fleex/shared';
import {
  selectCrashedMentionCards,
  isMentionExhausted,
  CRASH_REASON_COPY,
  crashReasonLabel,
} from './crashedMentionCards';

function mention(
  id: string,
  status: MentionStatus,
  overrides: Partial<TicketMention> = {},
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
    attemptCount: 0,
    maxAttempts: 3,
    failureReason: null,
    failureDetail: null,
    ...overrides,
  };
}

describe('selectCrashedMentionCards', () => {
  it('returns [] when no mention has failed', () => {
    const mentions = [mention('a', 'pending'), mention('b', 'acknowledged'), mention('c', 'resolved')];
    expect(selectCrashedMentionCards(mentions, {})).toEqual([]);
  });

  // WHY: the card is what tells the user a run ended badly at all — it must
  // appear for every failed agent mention, carrying the cause.
  it('surfaces a card for a failed agent mention with its persisted cause', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed', { failureReason: 'usage_limit', attemptCount: 1 })],
      {},
    );
    expect(cards).toHaveLength(1);
    expect(cards[0]!.mention.id).toBe('a');
    expect(cards[0]!.reason).toBe('usage_limit');
    expect(cards[0]!.label).toBe('Usage limit reached');
  });

  // WHY: the ticket's first acceptance criterion is "a timed-out agent appears
  // in `failed` WITH its reason". The WS event is ephemeral, so after a reload
  // only the persisted reason is left — if the selector relied on the event, the
  // cause would silently degrade to a generic message on every refresh.
  it('keeps the precise cause after a reload, with no live event left', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed', { failureReason: 'timeout', attemptCount: 1 })],
      {}, // cold reload: the ephemeral event is gone
    );
    expect(cards[0]!.reason).toBe('timeout');
    expect(cards[0]!.label).toBe('Timed out');
  });

  // WHY: the live event is an accelerator for the window before the companion
  // mention:updated lands — it must still render a usable card on its own.
  it('falls back to the live event while the persisted status is catching up', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed')],
      { a: { reason: 'not_authenticated', detail: 'claude: not logged in' } },
    );
    expect(cards[0]!.reason).toBe('not_authenticated');
    expect(cards[0]!.detail).toBe('claude: not logged in');
  });

  // WHY: the persisted value is the one a relaunch clears. Letting a stale live
  // event win would keep showing a cause the user already acted on.
  it('prefers the persisted cause over a stale live event', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed', { failureReason: 'timeout' })],
      { a: { reason: 'usage_limit' } },
    );
    expect(cards[0]!.reason).toBe('timeout');
  });

  it('degrades to the generic cause when nothing carries a reason', () => {
    const cards = selectCrashedMentionCards([mention('a', 'failed')], {});
    expect(cards).toHaveLength(1);
    expect(cards[0]!.reason).toBe('unknown');
    expect(cards[0]!.label).toBe('Session interrupted');
  });

  // WHY: only SDK-backed agent mentions can crash; a human/panel/skill mention
  // in an odd state must never masquerade as a crashed agent session.
  it('never surfaces a card for a non-agent target', () => {
    const cards = selectCrashedMentionCards(
      [mention('h', 'failed', {}, 'human'), mention('p', 'failed', {}, 'panel')],
      {},
    );
    expect(cards).toEqual([]);
  });

  // WHY: a run the user stopped on purpose is not a system failure. Painting it
  // alert-red would tell them something broke when nothing did.
  it('marks a user cancellation neutral, and a real failure as an error', () => {
    const [cancelled] = selectCrashedMentionCards([mention('a', 'failed', { failureReason: 'cancelled' })], {});
    const [crashed] = selectCrashedMentionCards([mention('b', 'failed', { failureReason: 'subprocess' })], {});
    expect(cancelled!.tone).toBe('neutral');
    expect(cancelled!.label).toBe('Stopped');
    expect(crashed!.tone).toBe('error');
  });
});

describe('attempt budget', () => {
  // WHY: the ticket's second acceptance criterion — past the ceiling the mention
  // must stop being one click away from another run.
  it('flags a mention that spent its budget as exhausted', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed', { failureReason: 'subprocess', attemptCount: 3, maxAttempts: 3 })],
      {},
    );
    expect(cards[0]!.exhausted).toBe(true);
    expect(cards[0]!.attemptCount).toBe(3);
    expect(cards[0]!.maxAttempts).toBe(3);
  });

  it('leaves a mention with budget left relaunchable', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed', { failureReason: 'subprocess', attemptCount: 2, maxAttempts: 3 })],
      {},
    );
    expect(cards[0]!.exhausted).toBe(false);
  });

  // WHY: `0` is "no cap" (a disabled ceiling, or a surface that does not
  // advertise one). Treating it as a cap would dead-letter every crash on sight.
  it('never reports exhaustion when no ceiling is advertised', () => {
    const cards = selectCrashedMentionCards(
      [mention('a', 'failed', { failureReason: 'subprocess', attemptCount: 9, maxAttempts: 0 })],
      {},
    );
    expect(cards[0]!.exhausted).toBe(false);
  });

  // WHY: mobile has no crash card — its relaunch sheet reads the predicate
  // straight off the mention. Both surfaces must agree on when the server will
  // reject a plain relaunch, or one of them offers a button that 409s.
  it('answers the same on a bare mention as on a card', () => {
    expect(isMentionExhausted({ attemptCount: 3, maxAttempts: 3 })).toBe(true);
    expect(isMentionExhausted({ attemptCount: 2, maxAttempts: 3 })).toBe(false);
    expect(isMentionExhausted({ attemptCount: 9, maxAttempts: 0 })).toBe(false);
  });
});

describe('reason copy', () => {
  it('maps reason codes to English labels, falling back for unknown codes', () => {
    expect(crashReasonLabel('usage_limit')).toBe('Usage limit reached');
    expect(crashReasonLabel('max_turns')).toBe('Turn limit reached');
    expect(crashReasonLabel('some_new_code')).toBe('Session interrupted');
  });

  // WHY: the ticket asks for the remediation copy to leave the server, which
  // sends English-speaking users French strings. That only holds if the client
  // catalogue is complete AND actually English — a missing code would fall back
  // to a generic message and lose the precise remediation.
  it('covers every reason code the server can emit, in English', () => {
    const reasons: MentionFailureReason[] = [
      'usage_limit', 'not_authenticated', 'billing', 'invalid_request', 'server_error',
      'max_turns', 'max_output_tokens', 'max_budget', 'output_format', 'subprocess',
      'timeout', 'cancelled', 'server_restart', 'startup_error', 'unknown',
    ];
    for (const reason of reasons) {
      const copy = CRASH_REASON_COPY[reason];
      expect(copy, `missing copy for ${reason}`).toBeDefined();
      expect(copy.label.length).toBeGreaterThan(0);
      expect(copy.remediation.length).toBeGreaterThan(0);
      // Accented characters are the cheapest reliable tell for leftover French.
      expect(`${copy.label} ${copy.remediation}`).not.toMatch(/[éèêàùçô]/);
    }
  });
});

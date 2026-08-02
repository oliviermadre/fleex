import { describe, it, expect } from 'vitest';
import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

function createMention(status: 'pending' | 'acknowledged' | 'resolved' | 'waiting_for_info' | 'failed' = 'pending') {
  const mention = TicketMentionEntity.create({
    id: 'mention-1',
    ticketId: 'ticket-1',
    commentId: 'comment-1',
    targetAgent: 'catalyst',
    sourceAgent: 'user',
  });
  // Fast-forward to desired status
  if (status === 'acknowledged') {
    mention.acknowledge();
  } else if (status === 'waiting_for_info') {
    mention.acknowledge();
    mention.waitForInfo();
  } else if (status === 'resolved') {
    mention.acknowledge();
    mention.resolve();
  } else if (status === 'failed') {
    mention.acknowledge();
    mention.markFailed('unknown');
  }
  return mention;
}

describe('TicketMentionEntity', () => {
  describe('waitForInfo()', () => {
    it('transitions from acknowledged to waiting_for_info', () => {
      const mention = createMention('acknowledged');
      mention.waitForInfo();
      expect(mention.status).toBe('waiting_for_info');
    });

    it('does not transition from pending', () => {
      const mention = createMention('pending');
      mention.waitForInfo();
      expect(mention.status).toBe('pending');
    });

    it('does not transition from resolved', () => {
      const mention = createMention('resolved');
      mention.waitForInfo();
      expect(mention.status).toBe('resolved');
    });
  });

  describe('wakeUp()', () => {
    it('transitions from waiting_for_info to pending', () => {
      const mention = createMention('waiting_for_info');
      mention.wakeUp();
      expect(mention.status).toBe('pending');
    });

    it('does not transition from pending', () => {
      const mention = createMention('pending');
      mention.wakeUp();
      expect(mention.status).toBe('pending');
    });

    it('does not transition from acknowledged', () => {
      const mention = createMention('acknowledged');
      mention.wakeUp();
      expect(mention.status).toBe('acknowledged');
    });

    it('does not transition from resolved', () => {
      const mention = createMention('resolved');
      mention.wakeUp();
      expect(mention.status).toBe('resolved');
    });
  });

  describe('markFailed()', () => {
    it('transitions from acknowledged to failed (crash after acknowledge)', () => {
      const mention = createMention('acknowledged');
      mention.markFailed('unknown');
      expect(mention.status).toBe('failed');
    });

    it('transitions from pending to failed (crash before acknowledge)', () => {
      const mention = createMention('pending');
      mention.markFailed('startup_error');
      expect(mention.status).toBe('failed');
    });

    it('does not transition from resolved (a completed run cannot retroactively fail)', () => {
      const mention = createMention('resolved');
      mention.markFailed('server_restart');
      expect(mention.status).toBe('resolved');
    });

    // WHY: the ticket's acceptance criterion is "a timed-out agent shows as
    // failed WITH its reason". The cause must live on the entity, not only in
    // the ephemeral WS event that a page reload throws away.
    it('persists the reason and the raw technical detail', () => {
      const mention = createMention('acknowledged');
      mention.markFailed('usage_limit', "You've hit your org's monthly usage limit");
      expect(mention.failureReason).toBe('usage_limit');
      expect(mention.failureDetail).toBe("You've hit your org's monthly usage limit");
    });

    // WHY: a timeout abort and a user cancel can land back-to-back on the same
    // run. The first terminal cause owns the record; a late writer must not
    // rewrite why the run died.
    it('keeps the first cause when a second failure lands on an already-failed mention', () => {
      const mention = createMention('acknowledged');
      mention.markFailed('timeout');
      mention.markFailed('cancelled', 'user pressed terminate');
      expect(mention.failureReason).toBe('timeout');
      expect(mention.failureDetail).toBeNull();
    });

    it('leaves a resolved mention without any failure cause', () => {
      const mention = createMention('resolved');
      mention.markFailed('server_restart', 'orphaned execution');
      expect(mention.failureReason).toBeNull();
      expect(mention.failureDetail).toBeNull();
    });
  });

  describe('attempt budget', () => {
    // WHY: the budget only stops a crash loop if it is charged at dispatch.
    // Charging at acknowledge would leave quota/auth crashes — which fail
    // *before* acknowledge — uncounted, i.e. infinitely retryable.
    it('counts one attempt per dispatch', () => {
      const mention = createMention('pending');
      expect(mention.attemptCount).toBe(0);
      mention.startAttempt();
      mention.startAttempt();
      expect(mention.attemptCount).toBe(2);
    });

    // WHY: an agent that eventually succeeds must not carry its past failures —
    // otherwise the next unrelated crash is dead-lettered on the first try.
    it('resets the budget and the failure cause when the run resolves', () => {
      const mention = createMention('acknowledged');
      mention.startAttempt();
      mention.startAttempt();
      mention.markFailed('timeout', 'exceeded');
      mention.resolve();
      expect(mention.attemptCount).toBe(0);
      expect(mention.failureReason).toBeNull();
      expect(mention.failureDetail).toBeNull();
    });

    // WHY: a human answering a waiting agent issues a NEW instruction, not a
    // retry — charging it the old budget would penalize a fresh request.
    it('resets the budget when a human wakes a waiting mention', () => {
      const mention = createMention('waiting_for_info');
      mention.startAttempt();
      mention.wakeUp();
      expect(mention.status).toBe('pending');
      expect(mention.attemptCount).toBe(0);
    });

    // WHY: dead-letter is a derived predicate, not a new mention status — that
    // keeps the 4 store adapters and every status filter untouched.
    it('reports exhaustion once the count reaches the ceiling', () => {
      const mention = createMention('pending');
      mention.startAttempt();
      mention.startAttempt();
      expect(mention.isExhausted(3)).toBe(false);
      mention.startAttempt();
      expect(mention.isExhausted(3)).toBe(true);
    });

    // WHY: a misconfigured ceiling must never freeze an instance — 0/negative
    // means "no cap", not "everything is dead-lettered".
    it('never reports exhaustion when the ceiling is disabled', () => {
      const mention = createMention('pending');
      for (let i = 0; i < 10; i++) mention.startAttempt();
      expect(mention.isExhausted(0)).toBe(false);
      expect(mention.isExhausted(-1)).toBe(false);
    });

    // WHY: Force relaunch is the user's only escape from the dead letter; if it
    // did not clear the budget the very next click would 409 again.
    it('clears the budget and the cause on a forced relaunch', () => {
      const mention = createMention('acknowledged');
      mention.startAttempt();
      mention.startAttempt();
      mention.startAttempt();
      mention.markFailed('unknown', 'EPIPE');
      mention.resetAttempts();
      mention.clearFailure();
      expect(mention.attemptCount).toBe(0);
      expect(mention.isExhausted(3)).toBe(false);
      expect(mention.failureReason).toBeNull();
    });

    // WHY: while a relaunched run is in flight the card must not still show the
    // previous crash reason.
    it('clears the stale cause when the mention is relaunched', () => {
      const mention = createMention('failed');
      mention.clearFailure();
      mention.resetToPending();
      expect(mention.status).toBe('pending');
      expect(mention.failureReason).toBeNull();
      expect(mention.failureDetail).toBeNull();
    });
  });

  describe('toDTO()', () => {
    // WHY: the crash card reads the persisted cause after a reload. If the DTO
    // drops these fields the card degrades to generic copy — the reload bug the
    // acceptance criterion ("failed with its reason") forbids.
    it('exposes the attempt budget and the failure cause', () => {
      const mention = createMention('acknowledged');
      mention.startAttempt();
      mention.markFailed('timeout', 'exceeded 30 min');
      const dto = mention.toDTO(3);
      expect(dto.attemptCount).toBe(1);
      expect(dto.maxAttempts).toBe(3);
      expect(dto.failureReason).toBe('timeout');
      expect(dto.failureDetail).toBe('exceeded 30 min');
    });
  });

  describe('resetToPending() from failed (relaunch)', () => {
    it('transitions a failed mention back to pending so it can be re-run', () => {
      const mention = createMention('failed');
      expect(mention.status).toBe('failed');
      mention.resetToPending();
      expect(mention.status).toBe('pending');
    });

    it('still resets an acknowledged mention (interrupted-execution recovery, unchanged)', () => {
      const mention = createMention('acknowledged');
      mention.resetToPending();
      expect(mention.status).toBe('pending');
    });

    it('does not touch a resolved mention', () => {
      const mention = createMention('resolved');
      mention.resetToPending();
      expect(mention.status).toBe('resolved');
    });
  });

  describe('full lifecycle: pending → acknowledged → waiting_for_info → pending → acknowledged → resolved', () => {
    it('supports the complete waiting_for_info cycle', () => {
      const mention = createMention('pending');
      expect(mention.status).toBe('pending');

      mention.acknowledge();
      expect(mention.status).toBe('acknowledged');

      mention.waitForInfo();
      expect(mention.status).toBe('waiting_for_info');

      mention.wakeUp();
      expect(mention.status).toBe('pending');

      mention.acknowledge();
      expect(mention.status).toBe('acknowledged');

      mention.resolve({ commentId: 'c-1', deliverableId: 'd-1' });
      expect(mention.status).toBe('resolved');
      expect(mention.resolvedAt).toBeInstanceOf(Date);
      expect(mention.resolvedCommentId).toBe('c-1');
      expect(mention.resolvedDeliverableId).toBe('d-1');
    });
  });
});

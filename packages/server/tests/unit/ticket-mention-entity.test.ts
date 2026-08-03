import { describe, it, expect } from 'vitest';

import { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

function createMention(
  status: 'pending' | 'acknowledged' | 'resolved' | 'waiting_for_info' | 'failed' = 'pending',
) {
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
    mention.markFailed();
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
      mention.markFailed();
      expect(mention.status).toBe('failed');
    });

    it('transitions from pending to failed (crash before acknowledge)', () => {
      const mention = createMention('pending');
      mention.markFailed();
      expect(mention.status).toBe('failed');
    });

    it('does not transition from resolved (a completed run cannot retroactively fail)', () => {
      const mention = createMention('resolved');
      mention.markFailed();
      expect(mention.status).toBe('resolved');
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

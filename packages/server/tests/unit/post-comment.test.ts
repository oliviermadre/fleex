import { describe, it, expect, beforeEach } from 'vitest';

import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';

import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';

// Minimal in-memory doubles — only the methods PostCommentUseCase touches.
class FakeCommentStore {
  saved: TicketCommentEntity[] = [];
  async save(comment: TicketCommentEntity): Promise<void> {
    this.saved.push(comment);
  }
}
class FakeMentionStore {
  saved: TicketMentionEntity[] = [];
  async save(mention: TicketMentionEntity): Promise<void> {
    this.saved.push(mention);
  }
}
class FakeTicketStore {
  async saveActivity(): Promise<void> {}
}
class FakeLogger {
  info(): void {}
  error(): void {}
  warn(): void {}
  debug(): void {}
}

describe('PostCommentUseCase — mention conflict suppression', () => {
  let comments: FakeCommentStore;
  let mentions: FakeMentionStore;
  let useCase: PostCommentUseCase;

  beforeEach(() => {
    comments = new FakeCommentStore();
    mentions = new FakeMentionStore();
    useCase = new PostCommentUseCase(
      comments as unknown as CommentStorePort,
      mentions as unknown as MentionStorePort,
      new FakeTicketStore() as unknown as TicketStorePort,
      new FakeLogger() as unknown as LoggerPort,
    );
  });

  it('creates a mention for a mentioned agent by default', async () => {
    const { createdMentions } = await useCase.execute({
      ticketId: 't1',
      authorType: 'user',
      authorName: 'olivier',
      body: '@agent:builder fais ci',
    });

    expect(createdMentions).toHaveLength(1);
    expect(createdMentions[0]!.targetAgent).toBe('builder');
    expect(mentions.saved).toHaveLength(1);
  });

  it('suppresses the new mention for an agent in suppressMentionForAgents', async () => {
    const { createdMentions } = await useCase.execute({
      ticketId: 't1',
      authorType: 'user',
      authorName: 'olivier',
      body: '@agent:builder oops non comme ça',
      suppressMentionForAgents: ['builder'],
    });

    // The comment is still posted (so the existing waiting mention can wake),
    // but no duplicate parallel mention is created.
    expect(createdMentions).toHaveLength(0);
    expect(mentions.saved).toHaveLength(0);
    expect(comments.saved).toHaveLength(1);
  });

  it('only suppresses the listed agent, not other mentioned agents', async () => {
    const { createdMentions } = await useCase.execute({
      ticketId: 't1',
      authorType: 'user',
      authorName: 'olivier',
      body: '@agent:builder continue and @agent:reviewer take a look',
      suppressMentionForAgents: ['builder'],
    });

    expect(createdMentions.map((m) => m.targetAgent)).toEqual(['reviewer']);
  });
});

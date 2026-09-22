import { describe, it, expect, beforeEach } from 'vitest';
import { PostCommentUseCase } from '../../src/application/use-cases/post-comment.js';
import type { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import type { TicketMentionEntity } from '../../src/domain/entities/ticket-mention.entity.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

// Minimal in-memory doubles — only the methods PostCommentUseCase touches.
class FakeCommentStore {
  saved: TicketCommentEntity[] = [];
  async save(comment: TicketCommentEntity): Promise<void> { this.saved.push(comment); }
}
class FakeMentionStore {
  saved: TicketMentionEntity[] = [];
  async save(mention: TicketMentionEntity): Promise<void> { this.saved.push(mention); }
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

describe('PostCommentUseCase — assistant threads', () => {
  class ThreadAwareCommentStore extends FakeCommentStore {
    async getById(id: string): Promise<TicketCommentEntity | null> {
      return this.saved.find((c) => c.id === id) ?? null;
    }
  }

  let comments: ThreadAwareCommentStore;
  let mentions: FakeMentionStore;
  let useCase: PostCommentUseCase;

  beforeEach(() => {
    comments = new ThreadAwareCommentStore();
    mentions = new FakeMentionStore();
    useCase = new PostCommentUseCase(
      comments as unknown as CommentStorePort,
      mentions as unknown as MentionStorePort,
      new FakeTicketStore() as unknown as TicketStorePort,
      new FakeLogger() as unknown as LoggerPort,
    );
  });

  it('an assistant-authored comment DOES create agent mentions', async () => {
    const { createdMentions, comment } = await useCase.execute({
      ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: '@agent:builder fix it', threadId: 'th1',
    });
    expect(createdMentions.map((m) => m.targetAgent)).toEqual(['builder']);
    expect(comment.threadId).toBe('th1');
    expect(comment.toDTO().threadId).toBe('th1');
  });

  it('an agent-authored comment still creates no mention', async () => {
    const { createdMentions } = await useCase.execute({
      ticketId: 't1', authorType: 'agent', authorName: 'The Builder', body: '@agent:pm look',
    });
    expect(createdMentions).toHaveLength(0);
  });

  it('suppressAgentMentions skips agent and panel mentions but keeps skills/workflows', async () => {
    const { createdMentions } = await useCase.execute({
      ticketId: 't1', authorType: 'user', authorName: 'olivier',
      body: '@agent:builder @panel:leadership @skill:lint @workflow:review', suppressAgentMentions: true,
    });
    expect(createdMentions.map((m) => m.targetType).sort()).toEqual(['skill', 'workflow']);
  });

  it('inherits threadId from the parent comment when parentId is given', async () => {
    const { comment: parent } = await useCase.execute({
      ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: '@agent:builder go', threadId: 'th1',
    });
    const { comment: reply } = await useCase.execute({
      ticketId: 't1', authorType: 'agent', authorName: 'The Builder', body: 'done', parentId: parent.id,
    });
    expect(reply.threadId).toBe('th1');
  });

  it('an explicit threadId: null on a reply is kept (no inheritance)', async () => {
    const { comment: parent } = await useCase.execute({
      ticketId: 't1', authorType: 'assistant', authorName: 'Nas', body: 'x', threadId: 'th1',
    });
    const { comment: reply } = await useCase.execute({
      ticketId: 't1', authorType: 'user', authorName: 'olivier', body: 'y', parentId: parent.id, threadId: null,
    });
    expect(reply.threadId).toBeNull();
  });
});

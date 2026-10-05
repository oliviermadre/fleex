import { describe, it, expect } from 'vitest';
import { hasUnstorableChars } from '@fleex/shared';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';

describe('TicketCommentEntity.extractWorkflowMentions', () => {
  it('extracts @workflow:slug mentions', () => {
    const out = TicketCommentEntity.extractWorkflowMentions('Hello @workflow:feature-delivery and @workflow:bug-fix');
    expect(out).toEqual(['feature-delivery', 'bug-fix']);
  });

  it('deduplicates', () => {
    expect(TicketCommentEntity.extractWorkflowMentions('@workflow:x @workflow:x')).toEqual(['x']);
  });

  it('skips struck-through mentions', () => {
    expect(TicketCommentEntity.extractWorkflowMentions('~~@workflow:cancelled~~ and @workflow:active')).toEqual(['active']);
  });

  it('does not match @workflow without colon', () => {
    expect(TicketCommentEntity.extractWorkflowMentions('plain @workflow text')).toEqual([]);
  });
});

describe('TicketCommentEntity questions', () => {
  it('defaults questions to null', () => {
    const c = TicketCommentEntity.create({ id: 'c', ticketId: 't', authorType: 'user', authorName: 'me', body: 'hi' });
    expect(c.questions).toBeNull();
    expect(c.toDTO().questions).toBeNull();
  });

  it('escapes chars a Postgres text/jsonb column rejects, like the body', () => {
    const c = TicketCommentEntity.create({
      id: 'c', ticketId: 't', authorType: 'agent', authorName: 'Dev', body: 'hi',
      questions: [{ prompt: 'P\u0000', options: ['A\u0000', 'B'] }],
    });
    const q = c.questions![0]!;
    expect([q.prompt, ...q.options].some(hasUnstorableChars)).toBe(false);
    expect(c.questions![0]!.options[1]).toBe('B');
  });
});

import { describe, it, expect } from 'vitest';
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

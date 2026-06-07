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

describe('TicketCommentEntity.updateBody (edit tracking)', () => {
  const make = () =>
    TicketCommentEntity.create({
      id: 'c1',
      ticketId: 't1',
      authorType: 'agent',
      authorName: 'alice',
      body: 'original',
    });

  it('is unedited on creation', () => {
    const c = make();
    expect(c.lastEditedAt).toBeNull();
    expect(c.lastEditedBy).toBeNull();
    expect(c.editCount).toBe(0);
    expect(c.toDTO().lastEditedAt).toBeNull();
  });

  it('stamps editor, date and increments count on a real edit', () => {
    const c = make();
    const changed = c.updateBody('edited', 'bob');
    expect(changed).toBe(true);
    expect(c.body).toBe('edited');
    expect(c.lastEditedBy).toBe('bob');
    expect(c.lastEditedAt).toBeInstanceOf(Date);
    expect(c.editCount).toBe(1);
  });

  it('is a no-op when the body is unchanged', () => {
    const c = make();
    const changed = c.updateBody('original', 'bob');
    expect(changed).toBe(false);
    expect(c.lastEditedAt).toBeNull();
    expect(c.editCount).toBe(0);
  });

  it('recomputes mentions on edit', () => {
    const c = make();
    c.updateBody('now mentions @agent:carol', 'bob');
    expect(c.mentions).toEqual(['carol']);
  });
});

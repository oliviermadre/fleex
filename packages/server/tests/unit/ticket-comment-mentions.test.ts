import { describe, it, expect } from 'vitest';

import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';

const UUID = '05d50f27-b12e-4338-8c36-e840fd288222';

// A @ticket:<id> mention is purely referential: it must NEVER be turned into an
// actionable mention (which would trigger an agent run). It is rendered as a chip
// on the client only.
describe('TicketCommentEntity — @ticket references are not actionable', () => {
  it('does not surface @ticket:<id> as an agent/panel/skill/workflow mention', () => {
    const body = `See @ticket:378 and @ticket:${UUID}`;
    expect(TicketCommentEntity.extractMentions(body)).toEqual([]);
    expect(TicketCommentEntity.extractPanelMentions(body)).toEqual([]);
    expect(TicketCommentEntity.extractSkillMentions(body)).toEqual([]);
    expect(TicketCommentEntity.extractWorkflowMentions(body)).toEqual([]);
  });

  it('never treats a ticket reference as a human mention — even if a user is named "ticket"', () => {
    const body = 'ping @ticket:378 please';
    expect(TicketCommentEntity.extractHumanMentions(body, ['ticket', 'olivier'])).toEqual([]);
  });

  it('never treats a ticket reference by uuid as a human mention', () => {
    const body = `ref @ticket:${UUID}`;
    expect(TicketCommentEntity.extractHumanMentions(body, ['ticket'])).toEqual([]);
  });

  it('still resolves a genuine human mention sitting next to a ticket reference', () => {
    const body = 'hey @olivier look at @ticket:378';
    expect(TicketCommentEntity.extractHumanMentions(body, ['olivier'])).toEqual(['olivier']);
  });

  it('still resolves a human named "ticket" when it is a real mention (no :id suffix)', () => {
    const body = 'cc @ticket for review';
    expect(TicketCommentEntity.extractHumanMentions(body, ['ticket'])).toEqual(['ticket']);
  });
});

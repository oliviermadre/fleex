import { describe, it, expect } from 'vitest';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

describe('TicketEntity.assistantPersonaId', () => {
  it('defaults to null and round-trips through the DTO', () => {
    const t = TicketEntity.create({ id: 't1', boardId: 'b1', displayId: 1, title: 'x' });
    expect(t.assistantPersonaId).toBeNull();
    expect(t.toDTO().assistantPersonaId).toBeNull();
  });

  it('updateExecutionConfig sets and clears the override with a diff', () => {
    const t = TicketEntity.create({ id: 't1', boardId: 'b1', displayId: 1, title: 'x' });
    expect(t.updateExecutionConfig({ assistantPersonaId: 'pa' })).toEqual({
      assistantPersonaId: { from: null, to: 'pa' },
    });
    expect(t.assistantPersonaId).toBe('pa');
    expect(t.updateExecutionConfig({ assistantPersonaId: 'pa' })).toEqual({});
    expect(t.updateExecutionConfig({ assistantPersonaId: null })).toEqual({
      assistantPersonaId: { from: 'pa', to: null },
    });
  });
});

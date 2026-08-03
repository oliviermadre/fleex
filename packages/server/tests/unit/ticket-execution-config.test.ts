import { describe, it, expect } from 'vitest';

import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

function ticket(): TicketEntity {
  return TicketEntity.create({ id: 'T1', boardId: 'B1', displayId: 1, title: 'Test' });
}

describe('TicketEntity.updateExecutionConfig — effort override', () => {
  it('accepts every level on the ladder, including the newer rungs', () => {
    for (const lvl of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
      const t = ticket();
      const diff = t.updateExecutionConfig({ effortOverride: lvl });
      expect(t.effortOverride).toBe(lvl);
      expect(diff['effortOverride']).toEqual({ from: null, to: lvl });
    }
  });

  it('clears the override on explicit null', () => {
    const t = ticket();
    t.updateExecutionConfig({ effortOverride: 'max' });
    const diff = t.updateExecutionConfig({ effortOverride: null });
    expect(t.effortOverride).toBeNull();
    expect(diff['effortOverride']).toEqual({ from: 'max', to: null });
  });

  it('ignores a value that is not a level, keeping the previous one', () => {
    // The PATCH body isn't schema-validated, so the entity is the write-side gate:
    // garbage must never reach the DB and later be handed to the SDK.
    const t = ticket();
    t.updateExecutionConfig({ effortOverride: 'high' });
    const diff = t.updateExecutionConfig({ effortOverride: 'ultra' as never });
    expect(t.effortOverride).toBe('high');
    expect(diff['effortOverride']).toBeUndefined();
  });

  it('leaves the override untouched when the key is absent', () => {
    const t = ticket();
    t.updateExecutionConfig({ effortOverride: 'xhigh' });
    t.updateExecutionConfig({ fastMode: true });
    expect(t.effortOverride).toBe('xhigh');
    expect(t.fastMode).toBe(true);
  });
});

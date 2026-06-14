import { describe, it, expect } from 'vitest';
import { deriveTicketUpdateEvents } from '../../src/domain/services/ticket-audit-events.js';

const NOW = new Date('2026-06-14T12:00:00.000Z');

describe('deriveTicketUpdateEvents', () => {
  it('maps favorite=true to a semantic ticket.favorited event (not ticket.updated)', () => {
    const events = deriveTicketUpdateEvents('T1', { favorite: { from: false, to: true } }, NOW);
    // Why: the audit trail must record the intent ("favorited"), not an opaque diff.
    expect(events).toEqual([{ type: 'ticket.favorited', ticketId: 'T1', occurredAt: NOW }]);
  });

  it('maps favorite=false to ticket.unfavorited', () => {
    const events = deriveTicketUpdateEvents('T1', { favorite: { from: true, to: false } }, NOW);
    expect(events).toEqual([{ type: 'ticket.unfavorited', ticketId: 'T1', occurredAt: NOW }]);
  });

  it('maps blocked transitions to ticket.blocked / ticket.unblocked', () => {
    expect(deriveTicketUpdateEvents('T1', { blocked: { from: false, to: true } }, NOW)[0]?.type)
      .toBe('ticket.blocked');
    expect(deriveTicketUpdateEvents('T1', { blocked: { from: true, to: false } }, NOW)[0]?.type)
      .toBe('ticket.unblocked');
  });

  it('emits ticket.tagsChanged with the computed added/removed delta', () => {
    const events = deriveTicketUpdateEvents(
      'T1',
      { tags: { from: ['a', 'b'], to: ['b', 'c'] } },
      NOW,
    );
    expect(events).toEqual([
      { type: 'ticket.tagsChanged', ticketId: 'T1', added: ['c'], removed: ['a'], occurredAt: NOW },
    ]);
  });

  it('does NOT emit tagsChanged when the tag set is unchanged (e.g. reorder)', () => {
    // Why: ticket.update() puts `tags` in the diff whenever provided, even if the
    // set is identical — that must not produce a content-less audit event.
    const events = deriveTicketUpdateEvents('T1', { tags: { from: ['a'], to: ['a'] } }, NOW);
    expect(events).toEqual([]);
  });

  it('keeps non-semantic fields on a single ticket.updated carrying only those keys', () => {
    const diff = {
      title: { from: 'old', to: 'new' },
      favorite: { from: false, to: true },
    };
    const events = deriveTicketUpdateEvents('T1', diff, NOW);
    expect(events).toContainEqual({ type: 'ticket.favorited', ticketId: 'T1', occurredAt: NOW });
    // The generic event must NOT leak the favorite key — it was promoted to a semantic event.
    expect(events).toContainEqual({
      type: 'ticket.updated',
      ticketId: 'T1',
      changes: { title: { from: 'old', to: 'new' } },
      occurredAt: NOW,
    });
  });

  it('emits no event for an empty diff (avoids content-less audit rows)', () => {
    expect(deriveTicketUpdateEvents('T1', {}, NOW)).toEqual([]);
  });

  it('emits ticket.updated for purely generic changes', () => {
    const diff = { priority: { from: 'low', to: 'high' } };
    const events = deriveTicketUpdateEvents('T1', diff, NOW);
    expect(events).toEqual([
      { type: 'ticket.updated', ticketId: 'T1', changes: diff, occurredAt: NOW },
    ]);
  });
});

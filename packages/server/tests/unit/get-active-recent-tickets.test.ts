import { describe, it, expect } from 'vitest';
import { getActiveRecentTickets } from '../../src/application/use-cases/get-active-recent-tickets.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { DeliverableStorePort } from '../../src/application/ports/deliverable-store.port.js';
import type { MentionStorePort } from '../../src/application/ports/mention-store.port.js';

const NOW = new Date('2026-06-01T12:00:00.000Z');
const iso = (d: string) => new Date(d).toISOString();

function ticket(id: string, displayId: number, updatedAt: string) {
  return { id, displayId, title: `T${displayId}`, status: 'doing' as const, updatedAt: iso(updatedAt) };
}

function deps(opts: {
  tickets: ReturnType<typeof ticket>[];
  comments?: { ticketId: string; updatedAt: string }[];
  deliverables?: { ticketId: string; updatedAt: string }[];
  mentions?: { ticketId: string; createdAt: string }[];
  windowDays?: number;
}) {
  const commentStore = {
    getByTicketIds: async () => (opts.comments ?? []).map((c) => ({ ticketId: c.ticketId, updatedAt: new Date(c.updatedAt) })),
  } as unknown as CommentStorePort;
  const deliverableStore = {
    getByTicketIds: async () => (opts.deliverables ?? []).map((d) => ({ ticketId: d.ticketId, updatedAt: new Date(d.updatedAt) })),
  } as unknown as DeliverableStorePort;
  const mentionStore = {
    getAll: async () => (opts.mentions ?? []).map((m) => ({ ticketId: m.ticketId, createdAt: new Date(m.createdAt) })),
  } as unknown as MentionStorePort;

  return { tickets: opts.tickets, commentStore, deliverableStore, mentionStore, now: NOW, windowDays: opts.windowDays };
}

describe('getActiveRecentTickets', () => {
  it('returns empty for no tickets', async () => {
    expect(await getActiveRecentTickets(deps({ tickets: [] }))).toEqual([]);
  });

  it('keeps tickets updated within the 7d window, drops older ones', async () => {
    const result = await getActiveRecentTickets(deps({
      tickets: [
        ticket('recent', 1, '2026-05-30T12:00:00.000Z'), // 2 days ago
        ticket('old', 2, '2026-05-01T12:00:00.000Z'),    // 31 days ago
      ],
    }));
    expect(result.map((t) => t.id)).toEqual(['recent']);
  });

  it('uses the max across sources — a recent comment revives an old ticket', async () => {
    const result = await getActiveRecentTickets(deps({
      tickets: [ticket('t1', 1, '2026-05-01T12:00:00.000Z')], // updatedAt old
      comments: [{ ticketId: 't1', updatedAt: '2026-05-31T12:00:00.000Z' }], // comment 1 day ago
    }));
    expect(result).toHaveLength(1);
    expect(result[0]!.lastActivityAt).toBe(iso('2026-05-31T12:00:00.000Z'));
    expect(result[0]!.activitySources).toContain('comment');
    expect(result[0]!.activitySources).not.toContain('updated'); // updated is outside window
  });

  it('aggregates deliverables and mentions too', async () => {
    const result = await getActiveRecentTickets(deps({
      tickets: [ticket('t1', 1, '2026-05-01T12:00:00.000Z')],
      deliverables: [{ ticketId: 't1', updatedAt: '2026-05-28T12:00:00.000Z' }],
      mentions: [{ ticketId: 't1', createdAt: '2026-05-31T18:00:00.000Z' }],
    }));
    expect(result[0]!.lastActivityAt).toBe(iso('2026-05-31T18:00:00.000Z'));
    expect(result[0]!.activitySources).toEqual(expect.arrayContaining(['deliverable', 'mention']));
  });

  it('sorts by most recent activity first', async () => {
    const result = await getActiveRecentTickets(deps({
      tickets: [
        ticket('a', 1, '2026-05-30T08:00:00.000Z'),
        ticket('b', 2, '2026-05-31T20:00:00.000Z'),
        ticket('c', 3, '2026-05-31T06:00:00.000Z'),
      ],
    }));
    expect(result.map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('ignores mentions belonging to other tickets', async () => {
    const result = await getActiveRecentTickets(deps({
      tickets: [ticket('t1', 1, '2026-05-01T12:00:00.000Z')],
      mentions: [{ ticketId: 'other', createdAt: '2026-05-31T12:00:00.000Z' }],
    }));
    expect(result).toEqual([]); // t1 only has an old update, the recent mention is for 'other'
  });
});

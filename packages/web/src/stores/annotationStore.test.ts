import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TimelineAnnotation } from '@fleex/shared';

const api = vi.hoisted(() => ({
  fetchTicketAnnotations: vi.fn(),
  createTicketAnnotation: vi.fn(),
  annotateComment: vi.fn(),
  updateTicketAnnotation: vi.fn(),
  deleteTicketAnnotation: vi.fn(),
}));
vi.mock('../services/api', () => api);

const ws = vi.hoisted(() => ({ handler: null as ((msg: { type: string; data: unknown }) => void) | null }));
vi.mock('../services/websocket', () => ({
  appWs: { onChannel: (_c: string, h: (msg: { type: string; data: unknown }) => void) => { ws.handler = h; return () => {}; } },
}));

import { annotationForComment, useAnnotationStore } from './annotationStore';

const s = () => useAnnotationStore.getState();
const saved = (id: string, over: Partial<TimelineAnnotation> = {}): TimelineAnnotation => ({
  id, ticketId: 't1', at: '2026-10-15T10:00:00.000Z', title: id, body: '', tone: 'info', sourceCommentId: null,
  authorType: 'user', authorName: 'nas', createdAt: '2026-10-15T10:00:00.000Z', updatedAt: '2026-10-15T10:00:00.000Z', ...over,
});
const draft = { at: '2026-10-15T10:00:00.000Z', title: 'Démo OK', body: 'texte', tone: 'success' as const };

beforeEach(async () => {
  Object.values(api).forEach((f) => f.mockReset());
  api.fetchTicketAnnotations.mockResolvedValue([]);
  useAnnotationStore.setState({ byTicket: {}, composer: null, highlight: null });
  await s().load('t1');
});

describe('annotationStore', () => {
  // §6: the card shows at once, then is confirmed — never a blank wait.
  it('shows a saving card at once, then swaps in the saved annotation', async () => {
    let resolve!: (a: TimelineAnnotation) => void;
    api.createTicketAnnotation.mockReturnValue(new Promise((r) => { resolve = r; }));
    const done = s().submit({ mode: 'create', ticketId: 't1', draft });
    expect(s().byTicket.t1).toEqual([expect.objectContaining({ title: 'Démo OK', uiState: 'saving' })]);
    resolve(saved('a1', { title: 'Démo OK' }));
    await done;
    expect(s().byTicket.t1).toEqual([saved('a1', { title: 'Démo OK' })]);
    expect(s().highlight?.id).toBe('a1');
  });

  // §6: a failed save keeps the text, on a red card, to retry or abandon.
  it('keeps a failed draft as an error card with its text', async () => {
    api.createTicketAnnotation.mockRejectedValue(new Error('500'));
    await s().submit({ mode: 'create', ticketId: 't1', draft });
    const [card] = s().byTicket.t1!;
    expect(card).toMatchObject({ uiState: 'error', title: 'Démo OK', body: 'texte' });
    s().discard('t1', card!.id);
    expect(s().byTicket.t1).toEqual([]);
  });

  it('pins a comment through the dedicated route', async () => {
    api.annotateComment.mockResolvedValue(saved('a1', { sourceCommentId: 'c1' }));
    await s().submit({ mode: 'promote', ticketId: 't1', commentId: 'c1', draft });
    expect(api.annotateComment).toHaveBeenCalledWith('t1', 'c1', draft);
    expect(annotationForComment(s().byTicket.t1, 'c1')?.id).toBe('a1');
  });

  // AC17: other clients' changes land without reloading — and a WS echo of our own create is not doubled.
  it('applies live WS changes for a loaded ticket, without duplicating our own create', async () => {
    ws.handler!({ type: 'annotation:created', data: saved('a1') });
    ws.handler!({ type: 'annotation:created', data: saved('other', { ticketId: 'not-loaded' }) });
    expect(s().byTicket.t1?.map((a) => a.id)).toEqual(['a1']);
    expect(s().byTicket['not-loaded']).toBeUndefined();

    ws.handler!({ type: 'annotation:updated', data: saved('a1', { title: 'renamed' }) });
    expect(s().byTicket.t1?.[0]?.title).toBe('renamed');

    api.createTicketAnnotation.mockImplementation(async () => {
      ws.handler!({ type: 'annotation:created', data: saved('a2') }); // echo arrives before the response
      return saved('a2');
    });
    await s().submit({ mode: 'create', ticketId: 't1', draft });
    expect(s().byTicket.t1?.map((a) => a.id)).toEqual(['a1', 'a2']);

    ws.handler!({ type: 'annotation:deleted', data: { id: 'a1', ticketId: 't1' } });
    expect(s().byTicket.t1?.map((a) => a.id)).toEqual(['a2']);
  });
});

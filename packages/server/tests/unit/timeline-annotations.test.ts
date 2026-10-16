import { describe, it, expect, beforeEach } from 'vitest';
import { TimelineAnnotationEntity, titleFromCommentBody } from '../../src/domain/entities/timeline-annotation.entity.js';
import { TicketCommentEntity } from '../../src/domain/entities/ticket-comment.entity.js';
import { TimelineAnnotationsUseCase } from '../../src/application/use-cases/timeline-annotations.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { CommentStorePort } from '../../src/application/ports/comment-store.port.js';
import type { TicketActivityEntity } from '../../src/domain/entities/ticket-activity.entity.js';
import type { AnyDomainEvent } from '../../src/domain/events.js';
import { FakeAnnotationStore } from '../helpers/fakes.js';

const CREATED = new Date('2026-10-14T09:00:00.000Z');
const NOW = new Date('2026-10-16T16:00:00.000Z');

const base = (over: Partial<Parameters<typeof TimelineAnnotationEntity.create>[0]> = {}) =>
  TimelineAnnotationEntity.create({
    id: 'a1', ticketId: 't1', ticketCreatedAt: CREATED, at: '2026-10-15T10:00:00.000Z', title: 'Pivot',
    authorType: 'user', authorName: 'Nas', now: NOW, ...over,
  });

describe('TimelineAnnotationEntity', () => {
  it('defaults to the info tone and an empty body', () => {
    expect(base().toDTO()).toMatchObject({ tone: 'info', body: '', sourceCommentId: null, at: '2026-10-15T10:00:00.000Z' });
  });

  // The title is always rendered on the card: empty would show a blank card,
  // over 80 would not fit the "readable at a glance" promise.
  it('requires a 1..80 char title', () => {
    expect(() => base({ title: '   ' })).toThrow(/title is required/);
    expect(() => base({ title: 'x'.repeat(81) })).toThrow(/at most 80/);
    expect(base({ title: `  ${'x'.repeat(80)}  ` }).title).toHaveLength(80);
  });

  it('caps the body at 4000 chars and rejects unknown tones', () => {
    expect(() => base({ body: 'x'.repeat(4001) })).toThrow(/at most 4000/);
    expect(() => base({ tone: 'pink' })).toThrow(/Invalid annotation tone/);
  });

  // There is no frieze before the ticket existed, and the frieze ends at now.
  it('refuses an instant before the ticket and clamps a future one to now', () => {
    expect(() => base({ at: '2026-10-13T00:00:00.000Z' })).toThrow(/before the ticket was created/);
    expect(base({ at: '2027-01-01T00:00:00.000Z' }).at).toEqual(NOW);
    expect(base({ at: 'now' }).at).toEqual(NOW);
    expect(() => base({ at: 'yesterday' })).toThrow(/Invalid annotation instant/);
  });

  it('rejects an invalid patch as a whole — nothing is half-applied', () => {
    const a = base();
    expect(() => a.update({ title: 'Nouveau', tone: 'nope' }, CREATED, NOW)).toThrow();
    expect(a.title).toBe('Pivot');
    a.update({ title: 'Nouveau', tone: 'warning', at: '2026-10-15T12:00:00.000Z' }, CREATED, NOW);
    expect(a.toDTO()).toMatchObject({ title: 'Nouveau', tone: 'warning', at: '2026-10-15T12:00:00.000Z' });
  });

  it('derives a promoted title from the first meaningful line of the comment, markdown stripped', () => {
    expect(titleFromCommentBody('![shot](/api/files/1)\n\n**On lâche Redis**, trop [lent](http://x)\nsuite')).toBe('On lâche Redis, trop lent');
    expect(titleFromCommentBody('y'.repeat(120))).toHaveLength(80);
  });
});

describe('TimelineAnnotationsUseCase', () => {
  let store: FakeAnnotationStore;
  let events: AnyDomainEvent[];
  let activities: TicketActivityEntity[];
  let comments: Map<string, TicketCommentEntity>;
  let uc: TimelineAnnotationsUseCase;
  const user = { type: 'user' as const, name: 'Nas' };
  const builder = { type: 'agent' as const, name: 'builder' };

  beforeEach(() => {
    store = new FakeAnnotationStore();
    events = [];
    activities = [];
    comments = new Map();
    const tickets = {
      getTicketById: async (id: string) => (id === 't1' ? { id: 't1', createdAt: CREATED } : null),
      saveActivity: async (a: TicketActivityEntity) => { activities.push(a); },
    } as unknown as TicketStorePort;
    const commentStore = { getById: async (id: string) => comments.get(id) ?? null } as unknown as CommentStorePort;
    uc = new TimelineAnnotationsUseCase(store, tickets, commentStore, (e) => events.push(e));
  });

  const addComment = (id: string, body: string, over: { visibility?: 'public' | 'private'; ticketId?: string } = {}) => {
    const c = TicketCommentEntity.create({ id, ticketId: over.ticketId ?? 't1', authorType: 'user', authorName: 'Nas', body, visibility: over.visibility });
    comments.set(id, c);
    return c;
  };

  it('creates an annotation, records the activity and emits the event the WS broadcast relays', async () => {
    const a = await uc.create('t1', { at: '2026-10-15T10:00:00.000Z', title: 'Démo OK', tone: 'success' }, user);
    expect(await uc.list('t1')).toHaveLength(1);
    expect(activities.map((x) => x.action)).toEqual(['annotation_added']);
    expect(events).toEqual([expect.objectContaining({ type: 'annotation.created', ticketId: 't1', annotation: a.toDTO() })]);
  });

  it('404s on an unknown ticket', async () => {
    await expect(uc.list('nope')).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
  });

  it('promotes a comment with its first line, full body and posting instant, linked back to it', async () => {
    const c = addComment('c1', 'Bug reproduit sur Safari\n\n![shot](/api/files/9)');
    const a = await uc.promote('t1', 'c1', {}, user);
    expect(a.toDTO()).toMatchObject({
      title: 'Bug reproduit sur Safari', body: c.body, at: c.createdAt.toISOString(), sourceCommentId: 'c1',
    });
  });

  it('refuses to pin the same comment twice (409)', async () => {
    addComment('c1', 'x');
    const first = await uc.promote('t1', 'c1', {}, user);
    await expect(uc.promote('t1', 'c1', {}, user)).rejects.toMatchObject({ code: 'COMMENT_ALREADY_ANNOTATED', annotationId: first.id });
  });

  it('does not let an agent promote a comment it cannot see, nor a comment of another ticket', async () => {
    addComment('secret', 'private', { visibility: 'private' });
    addComment('other', 'x', { ticketId: 't2' });
    await expect(uc.promote('t1', 'secret', {}, builder)).rejects.toMatchObject({ code: 'COMMENT_NOT_FOUND' });
    await expect(uc.promote('t1', 'other', {}, user)).rejects.toMatchObject({ code: 'COMMENT_NOT_FOUND' });
  });

  // AC15: an agent only touches what it wrote; humans can curate everything.
  it('lets an agent edit/delete only its own annotations, a human any', async () => {
    const mine = await uc.create('t1', { at: 'now', title: 'agent' }, builder);
    const theirs = await uc.create('t1', { at: 'now', title: 'human' }, user);
    await expect(uc.update('t1', theirs.id, { title: 'hack' }, builder)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(uc.remove('t1', theirs.id, builder)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(uc.remove('t1', theirs.id, { type: 'agent', name: 'Nas' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await uc.update('t1', mine.id, { tone: 'warning' }, builder);
    await uc.remove('t1', mine.id, user);
    expect((await uc.list('t1')).map((a) => a.title)).toEqual(['human']);
    expect(activities.map((x) => x.action)).toEqual(['annotation_added', 'annotation_added', 'annotation_removed']);
    expect(events.map((e) => e.type)).toEqual(['annotation.created', 'annotation.created', 'annotation.updated', 'annotation.deleted']);
  });

  it('404s an annotation looked up through the wrong ticket', async () => {
    const a = await uc.create('t1', { at: 'now', title: 'x' }, user);
    await expect(uc.update('t2', a.id, {}, user)).rejects.toMatchObject({ code: 'TICKET_NOT_FOUND' });
    store.rows.get(a.id)!; // still there
    await expect(uc.remove('t1', 'missing', user)).rejects.toMatchObject({ code: 'ANNOTATION_NOT_FOUND' });
  });

  // AC16: deleting the comment keeps the annotation, only the link goes — and open friezes learn it.
  it('keeps a promoted annotation when its comment is deleted, unlinked and re-broadcast', async () => {
    addComment('c1', 'x');
    const a = await uc.promote('t1', 'c1', {}, user);
    events = [];
    await uc.onCommentDeleted('c1');
    expect((await uc.list('t1'))[0]!.sourceCommentId).toBeNull();
    expect(events).toEqual([expect.objectContaining({ type: 'annotation.updated', annotationId: a.id, annotation: expect.objectContaining({ sourceCommentId: null }) })]);
    await uc.onCommentDeleted('unrelated');
    expect(events).toHaveLength(1);
  });
});

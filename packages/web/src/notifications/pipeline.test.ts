import { describe, it, expect } from 'vitest';

import { toNotification } from './pipeline';
import { NotificationRendererRegistry } from './registry';

import type { RendererContext } from './types';

const ctx: RendererContext = {
  ticketLink: (id, tab) => `/t/${id}${tab ? `/${tab}` : ''}`,
};

const fixedNow = () => '2026-06-04T00:00:00.000Z';

describe('toNotification', () => {
  it('returns null when no renderer is registered for the type', () => {
    const reg = new NotificationRendererRegistry();
    const out = toNotification({ type: 'comment:created', data: {} }, reg, ctx, fixedNow);
    expect(out).toBeNull();
  });

  it('promotes the dedup key to id and fills createdAt/seen', () => {
    const reg = new NotificationRendererRegistry();
    reg.register('x', () => ({
      dedupKey: 'key-1',
      emoji: '🔔',
      title: 'Title',
      body: 'Body',
      level: 'info',
      link: '/somewhere',
      ticketId: 't9',
    }));

    const out = toNotification({ type: 'x', data: {} }, reg, ctx, fixedNow);
    expect(out).toEqual({
      id: 'key-1',
      emoji: '🔔',
      title: 'Title',
      body: 'Body',
      level: 'info',
      link: '/somewhere',
      ticketId: 't9',
      createdAt: '2026-06-04T00:00:00.000Z',
      seen: false,
    });
  });

  it('returns null when the renderer opts out', () => {
    const reg = new NotificationRendererRegistry();
    reg.register('x', () => null);
    expect(toNotification({ type: 'x', data: {} }, reg, ctx, fixedNow)).toBeNull();
  });

  it('isolates renderer failures (a throwing renderer never breaks the stream)', () => {
    const reg = new NotificationRendererRegistry();
    reg.register('x', () => {
      throw new Error('renderer blew up');
    });
    expect(toNotification({ type: 'x', data: {} }, reg, ctx, fixedNow)).toBeNull();
  });
});

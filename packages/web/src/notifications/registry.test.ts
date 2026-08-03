import { describe, it, expect } from 'vitest';

import { NotificationRendererRegistry } from './registry';

import type { NotificationDraft } from './types';

const stub = (): NotificationDraft => ({
  dedupKey: 'k',
  emoji: '🔔',
  title: 't',
  body: 'b',
  level: 'info',
  link: '/x',
  ticketId: null,
});

describe('NotificationRendererRegistry', () => {
  it('registers and resolves a renderer by event type', () => {
    const reg = new NotificationRendererRegistry();
    const r = () => stub();
    reg.register('deliverable:created', r);

    expect(reg.has('deliverable:created')).toBe(true);
    expect(reg.get('deliverable:created')).toBe(r);
  });

  it('returns undefined for an unknown event type (open–closed: no crash)', () => {
    const reg = new NotificationRendererRegistry();
    expect(reg.get('comment:created')).toBeUndefined();
    expect(reg.has('comment:created')).toBe(false);
  });

  it('supports adding a new type without touching existing ones', () => {
    const reg = new NotificationRendererRegistry();
    reg.register('a', () => stub());
    reg.register('b', () => stub()); // a future V2 type — purely additive
    expect(reg.types().sort()).toEqual(['a', 'b']);
  });

  it('last registration wins for the same type', () => {
    const reg = new NotificationRendererRegistry();
    const first = () => stub();
    const second = () => stub();
    reg.register('x', first).register('x', second);
    expect(reg.get('x')).toBe(second);
  });
});

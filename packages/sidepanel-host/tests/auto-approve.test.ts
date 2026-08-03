import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  applyConfirm,
  applySetAutoApprove,
  disarmForPage,
  type PendingConfirm,
} from '../src/auto-approve.ts';
import { SessionStore } from '../src/sessions.ts';

let dir: string;
let store: SessionStore;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-auto-approve-'));
  store = new SessionStore(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function pendingFor(
  sessionId: string,
  name: string,
): { map: Map<string, PendingConfirm>; resolve: ReturnType<typeof vi.fn> } {
  const resolve = vi.fn();
  const map = new Map<string, PendingConfirm>([['call-1', { sessionId, name, resolve }]]);
  return { map, resolve };
}

describe('applyConfirm', () => {
  it('approves without granting anything when `always` is absent', () => {
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    const out = applyConfirm({ id: 'call-1', approved: true }, map, store);

    expect(out?.approved).toBe(true);
    expect(out?.allowlistChanged).toBe(false);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
    expect(map.size).toBe(0); // consumed
  });

  it('grants a per-tool standing approval on `always: tool`', () => {
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    const out = applyConfirm({ id: 'call-1', approved: true, always: 'tool' }, map, store);

    expect(out?.allowlistChanged).toBe(true);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: ['fleex_ticket_create'] });
  });

  it('grants a blanket approval on `always: session`', () => {
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    applyConfirm({ id: 'call-1', approved: true, always: 'session' }, map, store);

    expect(store.get(s.id)!.autoApprove).toEqual({ all: true, tools: [] });
  });

  it('never grants anything on a refusal, even with `always`', () => {
    // "Always" is an amplifier of an approval; it must not turn into a
    // standing *denial* the user never asked for.
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    const out = applyConfirm({ id: 'call-1', approved: false, always: 'tool' }, map, store);

    expect(out?.approved).toBe(false);
    expect(out?.allowlistChanged).toBe(false);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('takes the session and tool from SERVER state, not from the client frame', () => {
    // A frame that names another conversation (or another tool) must not be
    // able to widen approval beyond the call actually shown to the user.
    const target = store.create();
    const victim = store.create();
    const { map } = pendingFor(target.id, 'fleex_ticket_create');

    applyConfirm(
      {
        id: 'call-1',
        approved: true,
        always: 'tool',
        sessionId: victim.id,
        name: 'fleex_ticket_delete',
      },
      map,
      store,
    );

    expect(store.get(target.id)!.autoApprove).toEqual({
      all: false,
      tools: ['fleex_ticket_create'],
    });
    expect(store.get(victim.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('ignores a stale confirm id without touching the allowlist', () => {
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    expect(
      applyConfirm({ id: 'unknown', approved: true, always: 'session' }, map, store),
    ).toBeNull();
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
    expect(map.size).toBe(1); // the real pending call is untouched
  });

  it('ignores an unrecognised `always` scope', () => {
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    const out = applyConfirm({ id: 'call-1', approved: true, always: 'forever' }, map, store);

    expect(out?.approved).toBe(true);
    expect(out?.allowlistChanged).toBe(false);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });
});

describe('applySetAutoApprove', () => {
  it('replaces the whole state and reports the change', () => {
    const s = store.create();
    store.allowTool(s.id, 'fleex_ticket_create');

    expect(applySetAutoApprove({ id: s.id, all: false, tools: [] }, store)).toBe(true);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });

    expect(applySetAutoApprove({ id: s.id, all: true, tools: [] }, store)).toBe(true);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: true, tools: [] });
  });

  it('drops non-string entries from the tool list', () => {
    const s = store.create();
    applySetAutoApprove({ id: s.id, all: false, tools: ['fleex_ticket_create', 42, null] }, store);
    expect(store.get(s.id)!.autoApprove!.tools).toEqual(['fleex_ticket_create']);
  });

  it('is a silent no-op for an unknown session', () => {
    expect(applySetAutoApprove({ id: 'nope', all: true, tools: [] }, store)).toBe(false);
    expect(applySetAutoApprove({ all: true, tools: [] }, store)).toBe(false);
  });
});

describe('disarmForPage', () => {
  it('wipes a standing approval when untrusted page content is attached', () => {
    const s = store.create();
    store.allowTool(s.id, 'fleex_ticket_create');

    expect(disarmForPage(s.id, store)).toBe(true);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('wipes a blanket approval too', () => {
    const s = store.create();
    store.setAutoApprove(s.id, { all: true, tools: [] });
    expect(disarmForPage(s.id, store)).toBe(true);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('reports nothing to announce when no approval was armed', () => {
    const s = store.create();
    expect(disarmForPage(s.id, store)).toBe(false);
    expect(disarmForPage('unknown', store)).toBe(false);
  });
});

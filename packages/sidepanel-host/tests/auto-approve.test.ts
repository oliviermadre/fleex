import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SessionStore } from '../src/sessions.ts';
import { GlobalAllowlist } from '../src/global-allowlist.ts';
import {
  applyConfirm,
  applySetAutoApprove,
  disarmForPage,
  resolveAutoApproved,
  type PendingConfirm,
} from '../src/auto-approve.ts';

let dir: string;
let store: SessionStore;
let global: GlobalAllowlist;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-auto-approve-'));
  store = new SessionStore(path.join(dir, 'sessions'));
  global = new GlobalAllowlist(dir);
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function pendingFor(sessionId: string, name: string): { map: Map<string, PendingConfirm>; resolve: ReturnType<typeof vi.fn> } {
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
      { id: 'call-1', approved: true, always: 'tool', sessionId: victim.id, name: 'fleex_ticket_delete' },
      map,
      store,
    );

    expect(store.get(target.id)!.autoApprove).toEqual({ all: false, tools: ['fleex_ticket_create'] });
    expect(store.get(victim.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('ignores a stale confirm id without touching the allowlist', () => {
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    expect(applyConfirm({ id: 'unknown', approved: true, always: 'session' }, map, store)).toBeNull();
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

describe('applyConfirm + the machine-wide allowlist', () => {
  it('keys the grant on the CANONICAL tool name, never on a display label', () => {
    // Regression guard for the reported bug's hypothesis: if the allowlist were
    // ever keyed on what the button shows ("Ticket Link"), the read side would
    // never match `fleex_ticket_link` and the prompt would come back forever.
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_link');

    applyConfirm({ id: 'call-1', approved: true, always: 'tool' }, map, store, global);

    expect(global.list()).toEqual(['fleex_ticket_link']);
  });

  it('persists the grant so a later conversation stops asking', () => {
    const first = store.create();
    const { map } = pendingFor(first.id, 'fleex_ticket_link');
    applyConfirm({ id: 'call-1', approved: true, always: 'tool' }, map, store, global);

    const later = store.create();
    expect(resolveAutoApproved(later, global, 'fleex_ticket_link')).toBe(true);
  });

  it('keeps a blanket "allow everything" inside its own conversation', () => {
    // Trusting one conversation wholesale is a contextual judgement; it must
    // never leak into the next one.
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    applyConfirm({ id: 'call-1', approved: true, always: 'session' }, map, store, global);

    expect(global.list()).toEqual([]);
    expect(resolveAutoApproved(store.create(), global, 'fleex_ticket_create')).toBe(false);
  });

  it('keeps a grant local when the conversation ingested a web page', () => {
    const s = store.create();
    disarmForPage(s.id, store);
    const { map } = pendingFor(s.id, 'fleex_ticket_create');

    const out = applyConfirm({ id: 'call-1', approved: true, always: 'tool' }, map, store, global);

    expect(out?.globalChanged).toBe(false);
    expect(global.list()).toEqual([]);
    // Still granted in-conversation: the user consented to THIS call's tool
    // with the page in view, so the rest of the turn stops asking.
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: ['fleex_ticket_create'] });
  });

  it('never writes to the global list on a refusal', () => {
    const s = store.create();
    const { map } = pendingFor(s.id, 'fleex_ticket_create');
    applyConfirm({ id: 'call-1', approved: false, always: 'tool' }, map, store, global);
    expect(global.list()).toEqual([]);
  });
});

describe('resolveAutoApproved', () => {
  it('honours the machine-wide list in a clean conversation', () => {
    global.allow('fleex_ticket_link');
    expect(resolveAutoApproved(store.create(), global, 'fleex_ticket_link')).toBe(true);
  });

  it('only covers the exact tool that was granted', () => {
    global.allow('fleex_ticket_link');
    expect(resolveAutoApproved(store.create(), global, 'fleex_ticket_delete')).toBe(false);
  });

  it('ignores the machine-wide list once a page tainted the conversation', () => {
    // The prompt-injection guard: page content could ask for `ticket delete`,
    // and a permission earned in a safe conversation must not pay for it.
    global.allow('fleex_ticket_link');
    const s = store.create();
    disarmForPage(s.id, store);
    expect(resolveAutoApproved(store.get(s.id)!, global, 'fleex_ticket_link')).toBe(false);
  });

  it('still honours a grant made INSIDE the tainted conversation', () => {
    const s = store.create();
    disarmForPage(s.id, store);
    store.allowTool(s.id, 'fleex_ticket_link');
    expect(resolveAutoApproved(store.get(s.id)!, global, 'fleex_ticket_link')).toBe(true);
  });

  it('honours a blanket conversation approval for any tool', () => {
    const s = store.create();
    store.setAutoApprove(s.id, { all: true, tools: [] });
    expect(resolveAutoApproved(store.get(s.id)!, global, 'fleex_anything')).toBe(true);
  });

  it('approves nothing when neither scope granted it', () => {
    expect(resolveAutoApproved(store.create(), global, 'fleex_ticket_link')).toBe(false);
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

  it('taints the conversation for good, even with nothing armed to disarm', () => {
    // The injected instructions stay in the message history forever, so the
    // risk does not expire when the turn ends.
    const s = store.create();
    disarmForPage(s.id, store);
    expect(store.get(s.id)!.pageTainted).toBe(true);
  });

  it('does not revoke permissions earned in OTHER conversations', () => {
    // Attaching a page here is not a reason to punish the user everywhere.
    global.allow('fleex_ticket_link');
    const tainted = store.create();
    disarmForPage(tainted.id, store);

    expect(global.list()).toEqual(['fleex_ticket_link']);
    expect(resolveAutoApproved(store.create(), global, 'fleex_ticket_link')).toBe(true);
  });
});

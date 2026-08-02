import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  SessionStore,
  messageCount,
  isToolAutoApproved,
  isAutoApproveActive,
  type SessionData,
} from '../src/sessions.ts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-sessions-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('SessionStore', () => {
  it('creates, lists (newest first), and gets sessions', () => {
    const store = new SessionStore(dir);
    const a = store.create({ workspace: 'sqlite' });
    const b = store.create({ title: 'My work' });
    const list = store.list();
    expect(list.map((s) => s.id)).toEqual([b.id, a.id]); // newest first
    expect(list[1]!.workspace).toBe('sqlite');
    expect(list[0]!.title).toBe('My work');
    expect(store.get(a.id)!.status).toBe('idle');
  });

  it('stores and surfaces a per-conversation model', () => {
    const store = new SessionStore(dir);
    const s = store.create({ model: 'claude-haiku-4-5' });
    expect(store.get(s.id)!.model).toBe('claude-haiku-4-5');
    expect(store.list()[0]!.model).toBe('claude-haiku-4-5');
    // A session with no model omits the field (host default applies).
    const plain = store.create({});
    expect(store.get(plain.id)!.model).toBeUndefined();
    expect(store.list().find((x) => x.id === plain.id)!.model).toBeUndefined();
    // Survives a reload.
    expect(new SessionStore(dir).get(s.id)!.model).toBe('claude-haiku-4-5');
  });

  it('renames and deletes', () => {
    const store = new SessionStore(dir);
    const s = store.create();
    store.rename(s.id, 'Renamed');
    expect(store.get(s.id)!.title).toBe('Renamed');
    expect(store.delete(s.id)).toBe(true);
    expect(store.get(s.id)).toBeUndefined();
    expect(store.delete('nope')).toBe(false);
  });

  it('counts user + assistant transcript items as messages (not tool lines)', () => {
    const s: SessionData = {
      id: 'x', title: 't', status: 'idle', createdAt: '2020', messages: [],
      transcript: [
        { role: 'user', text: 'hi' },
        { tool: { name: 'fleex_ticket_list', argv: [], status: 'ok' } },
        { role: 'assistant', text: 'here' },
      ],
    };
    expect(messageCount(s)).toBe(2);
  });

  it('derives a title from the first user message, once', () => {
    const store = new SessionStore(dir);
    const s = store.create();
    store.maybeTitleFrom(s.id, '  list   my doing tickets please  ');
    expect(store.get(s.id)!.title).toBe('list my doing tickets please');
    store.maybeTitleFrom(s.id, 'second message');
    expect(store.get(s.id)!.title).toBe('list my doing tickets please'); // unchanged
  });

  it('persists across store instances and resets stale status on hydrate', () => {
    const store = new SessionStore(dir);
    const s = store.create({ workspace: 'tada', title: 'Persisted' });
    s.messages.push({ role: 'user', content: 'hello' });
    s.transcript.push({ role: 'user', text: 'hello' });
    store.setStatus(s.id, 'working'); // saved as working
    store.save(s.id);

    const reopened = new SessionStore(dir);
    const got = reopened.get(s.id)!;
    expect(got.title).toBe('Persisted');
    expect(got.workspace).toBe('tada');
    expect(got.transcript).toHaveLength(1);
    expect(got.status).toBe('idle'); // a stale 'working' is reset on load
  });
});

describe('SessionStore auto-approval', () => {
  it('starts every new conversation with no standing approval', () => {
    const store = new SessionStore(dir);
    const s = store.create();
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
    expect(store.list()[0]!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('does not inherit approvals granted in another conversation', () => {
    const store = new SessionStore(dir);
    const granted = store.create();
    store.allowTool(granted.id, 'fleex_ticket_create');
    const fresh = store.create();
    expect(store.get(fresh.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('allows a tool idempotently and survives a companion restart', () => {
    // A restart mid-batch must not re-arm 30 confirmations the user already
    // cleared, so the allowlist is persisted alongside the session.
    const store = new SessionStore(dir);
    const s = store.create();
    store.allowTool(s.id, 'fleex_ticket_create');
    store.allowTool(s.id, 'fleex_ticket_create');
    expect(store.get(s.id)!.autoApprove!.tools).toEqual(['fleex_ticket_create']);

    expect(new SessionStore(dir).get(s.id)!.autoApprove).toEqual({
      all: false,
      tools: ['fleex_ticket_create'],
    });
  });

  it('keeps allowTool a no-op once everything is auto-approved', () => {
    const store = new SessionStore(dir);
    const s = store.create();
    store.setAutoApprove(s.id, { all: true, tools: [] });
    store.allowTool(s.id, 'fleex_ticket_create');
    expect(store.get(s.id)!.autoApprove).toEqual({ all: true, tools: [] });
  });

  it('replaces (never patches) on setAutoApprove and clears on demand', () => {
    const store = new SessionStore(dir);
    const s = store.create();
    store.setAutoApprove(s.id, { all: false, tools: ['a', 'b'] });
    store.setAutoApprove(s.id, { all: false, tools: ['c'] });
    expect(store.get(s.id)!.autoApprove!.tools).toEqual(['c']);
    store.clearAutoApprove(s.id);
    expect(store.get(s.id)!.autoApprove).toEqual({ all: false, tools: [] });
  });

  it('ignores auto-approval writes for an unknown session', () => {
    const store = new SessionStore(dir);
    expect(() => store.allowTool('nope', 'fleex_ticket_create')).not.toThrow();
    expect(() => store.setAutoApprove('nope', { all: true, tools: [] })).not.toThrow();
  });

  it('hydrates a session persisted before the field existed', () => {
    const legacy: SessionData = {
      id: 'legacy', title: 'Old', status: 'idle', createdAt: '2020', messages: [], transcript: [],
    };
    fs.writeFileSync(path.join(dir, 'legacy.json'), JSON.stringify(legacy));
    const store = new SessionStore(dir);
    expect(store.get('legacy')!.autoApprove).toEqual({ all: false, tools: [] });
    expect(store.list().find((x) => x.id === 'legacy')!.autoApprove).toEqual({ all: false, tools: [] });
  });
});

describe('isToolAutoApproved / isAutoApproveActive', () => {
  it.each([
    ['undefined state', undefined, 'fleex_ticket_create', false],
    ['empty allowlist', { all: false, tools: [] }, 'fleex_ticket_create', false],
    ['listed tool', { all: false, tools: ['fleex_ticket_create'] }, 'fleex_ticket_create', true],
    ['unlisted tool', { all: false, tools: ['fleex_ticket_create'] }, 'fleex_ticket_delete', false],
    ['blanket', { all: true, tools: [] }, 'fleex_ticket_delete', true],
  ])('%s', (_label, aa, name, expected) => {
    expect(isToolAutoApproved(aa, name as string)).toBe(expected);
  });

  it('reports whether anything is armed', () => {
    expect(isAutoApproveActive(undefined)).toBe(false);
    expect(isAutoApproveActive({ all: false, tools: [] })).toBe(false);
    expect(isAutoApproveActive({ all: false, tools: ['x'] })).toBe(true);
    expect(isAutoApproveActive({ all: true, tools: [] })).toBe(true);
  });
});

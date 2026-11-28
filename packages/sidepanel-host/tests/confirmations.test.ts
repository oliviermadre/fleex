import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyConfirm, denyAll, type PendingConfirm } from '../src/confirmations.ts';
import { SessionStore } from '../src/sessions.ts';
import type { OutsideWriteDecision } from '../src/outside-write-guard.ts';

let dir: string;
beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fleex-confirm-'))));
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function pendingFor(sessionId: string, id: string, got: OutsideWriteDecision[]): Map<string, PendingConfirm> {
  return new Map([[id, { sessionId, request: { id, tool: 'Write', path: '/x', diff: '', isNewFile: true }, resolve: (d) => got.push(d) }]]);
}

describe('confirm frames', () => {
  it('grants "always" to the pending call\'s own conversation, whatever the frame names', () => {
    const store = new SessionStore(dir);
    const a = store.create();
    const b = store.create();
    const got: OutsideWriteDecision[] = [];
    const out = applyConfirm({ id: 'c1', decision: 'always', sessionId: b.id }, pendingFor(a.id, 'c1', got), store);
    expect(out?.decision).toBe('always');
    expect(store.get(a.id)!.outsideWritesAllowed).toBe(true);
    expect(store.get(b.id)!.outsideWritesAllowed).toBe(false);
  });

  it('ignores a stale frame and reads older clients\' answers', () => {
    const store = new SessionStore(dir);
    const got: OutsideWriteDecision[] = [];
    expect(applyConfirm({ id: 'nope', decision: 'allow' }, new Map(), store)).toBeNull();
    expect(applyConfirm({ id: 'c1', approved: true }, pendingFor('s', 'c1', got), store)?.decision).toBe('allow');
    expect(applyConfirm({ id: 'c1', approved: false }, pendingFor('s', 'c1', got), store)?.decision).toBe('deny');
  });

  it('refuses every pending call of a stopped conversation, and only those', () => {
    const got: OutsideWriteDecision[] = [];
    const pending = pendingFor('s1', 'c1', got);
    pending.set('c2', { sessionId: 's2', request: { id: 'c2', tool: 'Write', path: '/y', diff: '', isNewFile: true }, resolve: (d) => got.push(d) });
    expect(denyAll('s1', pending)).toBe(1);
    expect(got).toEqual(['deny']);
    expect(pending.has('c2')).toBe(true);
  });
});

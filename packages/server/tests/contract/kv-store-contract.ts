/**
 * Driver-agnostic contract for KvStorePort.
 *
 * `json` shipped with `kvStore: null`, which turned unread-badge cursors into
 * silent no-ops. Every driver runs this suite so the gap cannot reopen.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { KvStorePort } from '../../src/application/ports/kv-store.port.js';

export interface KvStoreHarness {
  store: KvStorePort;
  teardown(): Promise<void>;
}

export function runKvStoreContract(
  driverName: string,
  createHarness: () => Promise<KvStoreHarness>,
): void {
  describe(`kv store contract — ${driverName}`, () => {
    let h: KvStoreHarness;

    beforeEach(async () => {
      h = await createHarness();
    });

    afterEach(async () => {
      await h.teardown();
    });

    it('returns null for a key that was never set', async () => {
      expect(await h.store.get('missing')).toBeNull();
    });

    it('round-trips a value', async () => {
      await h.store.set('greeting', 'hello');
      expect(await h.store.get('greeting')).toBe('hello');
    });

    it('overwrites an existing key rather than appending', async () => {
      await h.store.set('k', 'first');
      await h.store.set('k', 'second');
      expect(await h.store.get('k')).toBe('second');
      expect(await h.store.listByPrefix('k')).toHaveLength(1);
    });

    it('preserves multi-line values — the scratchpad stores markdown', async () => {
      const markdown = '# Title\n\n- item one\n- item two\n';
      await h.store.set('scratchpad:__global__', markdown);
      expect(await h.store.get('scratchpad:__global__')).toBe(markdown);
    });

    it('deletes a key', async () => {
      await h.store.set('k', 'v');
      await h.store.delete('k');
      expect(await h.store.get('k')).toBeNull();
    });

    it('tolerates deleting a key that does not exist', async () => {
      await expect(h.store.delete('never-existed')).resolves.toBeUndefined();
    });

    it('lists by prefix and excludes non-matching keys', async () => {
      await h.store.set('cursor:ticket-1', '10');
      await h.store.set('cursor:ticket-2', '20');
      await h.store.set('other:thing', '30');

      const found = await h.store.listByPrefix('cursor:');
      expect(found.map((e) => e.key).sort()).toEqual(['cursor:ticket-1', 'cursor:ticket-2']);
      expect(found.find((e) => e.key === 'cursor:ticket-1')?.value).toBe('10');
    });

    it('returns an empty list when no key matches the prefix', async () => {
      await h.store.set('a', '1');
      expect(await h.store.listByPrefix('zzz')).toEqual([]);
    });
  });
}

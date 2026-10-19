import { describe, it, expect } from 'vitest';
import { SupabaseMemoryStoreAdapter } from '../../src/infrastructure/adapters/supabase/supabase-memory-store.adapter.js';
import type { SupabaseConnection } from '../../src/infrastructure/adapters/supabase/connection.js';

const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/** Records the PostgREST calls, so the test can assert the filters sent. */
function recordingClient(count: number) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'not', 'eq', 'in', 'or']) {
    builder[method] = (...args: unknown[]) => { calls.push([method, ...args]); return builder; };
  }
  builder.then = (resolve: (v: { count: number; error: null }) => void) => resolve({ count, error: null });
  return { calls, client: { from: (table: string) => { calls.push(['from', table]); return builder; } } };
}

describe('SupabaseMemoryStoreAdapter.countSearchable', () => {
  // Must narrow on what `match_memory_chunks` narrows on, or the count describes
  // a different set than the search that came back empty.
  it('filters on kinds, repo, model and embedding presence, and counts without rows', async () => {
    const { calls, client } = recordingClient(23);
    const store = new SupabaseMemoryStoreAdapter({ client } as unknown as SupabaseConnection, silent as never);

    const n = await store.countSearchable({ kinds: ['persona'], repo: 'org/app', embeddingModel: 'm1' });

    expect(n).toBe(23);
    expect(calls).toContainEqual(['select', 'id', { count: 'exact', head: true }]);
    expect(calls).toContainEqual(['not', 'embedding', 'is', null]);
    expect(calls).toContainEqual(['eq', 'embedding_model', 'm1']);
    expect(calls).toContainEqual(['in', 'source_kind', ['persona']]);
    expect(calls).toContainEqual(['eq', 'repo', 'org/app']);
  });
});

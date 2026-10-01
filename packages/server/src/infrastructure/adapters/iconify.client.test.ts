import { describe, it, expect, vi, afterEach } from 'vitest';
import { CACHE_MAX_ENTRIES, IconifyClient } from './iconify.client.js';

const BODY = '<path d="M4 4h16v16H4z"/>';

/** A fake Iconify API: `count` lucide icons per search, every requested icon resolvable. */
function fakeApi(count: number) {
  const calls: string[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push(url.toString());
    if (url.pathname === '/search') {
      const q = url.searchParams.get('query') ?? '';
      const icons = Array.from({ length: count }, (_, i) => `lucide:${q}-${i}`);
      return new Response(JSON.stringify({ icons }));
    }
    const names = (url.searchParams.get('icons') ?? '').split(',');
    return new Response(JSON.stringify({ width: 24, height: 24, icons: Object.fromEntries(names.map((n) => [n, { body: BODY }])) }));
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

describe('IconifyClient', () => {
  afterEach(() => vi.useRealTimers());

  it('returns up to the requested limit (the library tab asks for 30), not a hard-coded 18', async () => {
    const { fetchFn } = fakeApi(40);
    const client = new IconifyClient(fetchFn);
    const results = await client.search(['cloud'], { brandFirst: false, limit: 30 });
    expect(results).toHaveLength(30);
  });

  it('encodes keywords and only ever requests the allowed sets', async () => {
    const { fetchFn, calls } = fakeApi(2);
    const client = new IconifyClient(fetchFn);
    await client.search(['a/../b&prefixes=evil'], { brandFirst: false, limit: 5, includeBrands: false });
    const search = new URL(calls[0]!);
    expect(search.pathname).toBe('/search');
    expect(search.searchParams.get('query')).toBe('a/../b&prefixes=evil');
    expect(search.searchParams.get('prefixes')).toBe('lucide,tabler');
  });

  it('bounds the cache: the oldest search is evicted, a recently used one is kept', async () => {
    const { fetchFn, calls } = fakeApi(1);
    const client = new IconifyClient(fetchFn);
    const opts = { brandFirst: false, limit: 1 };
    await client.search(['q0'], opts);
    await client.search(['q1'], opts);
    for (let i = 2; i < CACHE_MAX_ENTRIES; i += 1) await client.search([`q${i}`], opts);
    await client.search(['q0'], opts); // hit: q0 becomes most recent
    const before = calls.length;
    await client.search(['overflow'], opts); // evicts the least recently used: q1

    expect(calls.length).toBe(before + 2);
    await client.search(['q0'], opts);
    expect(calls.length).toBe(before + 2); // still cached
    await client.search(['q1'], opts);
    expect(calls.length).toBe(before + 4); // evicted, fetched again
  });

  it('drops an expired entry and fetches again', async () => {
    vi.useFakeTimers();
    const { fetchFn, calls } = fakeApi(1);
    const client = new IconifyClient(fetchFn);
    await client.search(['gh'], { brandFirst: false, limit: 1 });
    vi.advanceTimersByTime(25 * 60 * 60 * 1000);
    await client.search(['gh'], { brandFirst: false, limit: 1 });
    expect(calls).toHaveLength(4);
  });
});

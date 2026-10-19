/**
 * `fleex memory search --kind` — and the MCP tool generated from it.
 *
 * The kind used to be applied here, to the ten rows the server had already
 * ranked across every kind, so a sparse kind came back empty. These tests pin
 * that the kind travels to the server, and that an empty answer says why.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';

vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:1234',
  apiGet: vi.fn(),
}));

import { setJsonMode } from '../../src/core/colors.ts';
import { apiGet } from '../../src/core/api.ts';
import searchDef, { describeEmpty } from '../../src/commands/memory/search/index.ts';
import { MEMORY_SOURCE_KINDS } from '../../src/commands/memory/_shared.ts';
import { MEMORY_SOURCE_KINDS as DOMAIN_KINDS } from '../../../server/src/domain/entities/memory-chunk.entity.ts';

class ExitError extends Error { constructor(public code: number) { super(`exit ${code}`); } }

async function run(query: string, opts: Record<string, unknown>) {
  const out: string[] = [];
  const so = process.stdout.write;
  const se = process.stderr.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((ch: any) => { out.push(String(ch)); return true; }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = ((ch: any) => { out.push(String(ch)); return true; }) as any;
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new ExitError(code); }) as never);
  let code: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (searchDef.action as any)([query], opts);
  } catch (e) {
    if (e instanceof ExitError) code = e.code; else throw e;
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
    exit.mockRestore();
  }
  return { out: out.join(''), code };
}

const persona = { sourceKind: 'persona', sourceId: 'p1', title: 'Agent builder', content: 'ships', score: 0.6 };

afterEach(() => {
  setJsonMode(false);
  vi.mocked(apiGet).mockReset();
});

describe('memory search --kind', () => {
  it('sends the kind to the server and shows what it returns, unfiltered', async () => {
    vi.mocked(apiGet).mockResolvedValue({ query: 'q', results: [persona], scope: { kinds: ['persona'], repo: null } });
    const { out } = await run('q', { kind: 'persona' });

    const url = vi.mocked(apiGet).mock.calls[0]![0] as string;
    expect(new URL(url, 'http://x').searchParams.get('kind')).toBe('persona');
    expect(out).toContain('Agent builder');
  });

  it('rejects an unknown kind locally, without calling the server', async () => {
    const { out, code } = await run('q', { kind: 'personas' });
    expect(code).not.toBe(0);
    expect(out).toContain('Unknown --kind "personas"');
    expect(apiGet).not.toHaveBeenCalled();
  });

  it('says the kind is empty, rather than "nothing found", when nothing of it is indexed', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      query: 'q', results: [], scope: { kinds: ['curated_note'], repo: null, searchableChunks: 0 },
    });
    const { out } = await run('q', { kind: 'curated_note' });
    expect(out).toContain('No "curated_note" chunks are indexed yet');
  });

  it('carries the scope in JSON only for an empty filtered result, so the bare array stays the norm', async () => {
    setJsonMode(true);
    const scope = { kinds: ['curated_note'], repo: null, searchableChunks: 0 };
    vi.mocked(apiGet).mockResolvedValue({ query: 'q', results: [], scope });
    expect(JSON.parse((await run('q', { kind: 'curated_note' })).out)).toEqual({ results: [], scope });

    vi.mocked(apiGet).mockResolvedValue({ query: 'q', results: [persona], scope: { kinds: ['persona'], repo: null } });
    expect(JSON.parse((await run('q', { kind: 'persona' })).out)).toEqual([persona]);
  });
});

describe('describeEmpty', () => {
  it('keeps the plain message when the search was not filtered', () => {
    expect(describeEmpty('q', undefined)).toBe('Nothing found for "q".');
  });

  it('names the repo when the empty scope combines kind and repo', () => {
    expect(describeEmpty('q', { kinds: ['deliverable'], repo: 'org/app', searchableChunks: 0 }))
      .toBe('No "deliverable" chunks attached to org/app are indexed.');
  });

  it('flags a populated scope that returned nothing as a bug, not as an empty answer', () => {
    expect(describeEmpty('q', { kinds: ['persona'], repo: null, searchableChunks: 23 }))
      .toContain('this should not happen');
  });
});

describe('kind list', () => {
  // The CLI keeps its own copy (it does not depend on the server package), so a
  // kind added to the domain must be added here too, or --kind would reject it.
  it('matches the domain list exactly', () => {
    expect([...MEMORY_SOURCE_KINDS]).toEqual([...DOMAIN_KINDS]);
  });
});

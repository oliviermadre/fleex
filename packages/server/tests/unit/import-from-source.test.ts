import { describe, it, expect, vi } from 'vitest';
import type { ResolvedImport, SourceMatch } from '@fleex/shared';
import { ImportFromSourceUseCase } from '../../src/application/use-cases/import-from-source.js';
import { ImportSourceRegistry } from '../../src/application/services/import-sources/registry.js';
import type { ImportSourceAdapter } from '../../src/application/ports/import-source.port.js';
import { ImportError } from '../../src/domain/errors.js';

const makeLogger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

/** A minimal ticket store: records createTicket/saveActivity, canned linked tickets. */
const makeTicketStore = (linked: Record<string, unknown[]> = {}) => ({
  _created: [] as unknown[],
  createTicket: vi.fn(async function (this: { _created: unknown[] }, t: unknown) {
    this._created.push(t);
  }),
  saveActivity: vi.fn(async () => {}),
  getTicketsLinkedTo: vi.fn(async (_type: string, ref: string) => linked[ref] ?? []),
});

/** A fake adapter returning a canned ResolvedImport, recording the resolve opts. */
const makeAdapter = (id: ImportSourceAdapter['id'], resolved: ResolvedImport): ImportSourceAdapter & {
  lastMatch?: SourceMatch;
  lastOpts?: { signal?: AbortSignal };
} => {
  const adapter = {
    id,
    resolve: vi.fn(async (match: SourceMatch, opts?: { signal?: AbortSignal }) => {
      adapter.lastMatch = match;
      adapter.lastOpts = opts;
      return resolved;
    }),
  } as ImportSourceAdapter & { lastMatch?: SourceMatch; lastOpts?: { signal?: AbortSignal } };
  return adapter;
};

const ISSUE_RESOLVED: ResolvedImport = {
  title: 'Fix the thing',
  description: 'body\n\n---\n\n#### GitHub Metadata\n\n- **Issue**: #12',
  tags: ['bug'],
  links: [{ type: 'github_issue', ref: 'Evaneos/Fleex#12', label: '#12', url: 'https://github.com/Evaneos/Fleex/issues/12' }],
  repo: { org: 'Evaneos', name: 'Fleex' },
  githubMetadata: { state: 'OPEN', author: 'x', assignees: [], labels: ['bug'], milestone: null, syncedAt: '2020' },
};

const PR_RESOLVED: ResolvedImport = {
  title: 'A PR',
  description: 'pr body',
  tags: [],
  links: [{ type: 'github_pr', ref: 'evaneos/fleex#7', label: '#7', url: 'https://github.com/Evaneos/Fleex/pull/7' }],
  repo: { org: 'Evaneos', name: 'Fleex', headRefName: 'feat/x', isCrossRepository: false, prState: 'open' },
  suggested: { type: 'review' },
};

describe('ImportSourceRegistry', () => {
  const a = makeAdapter('github_issue', ISSUE_RESOLVED);
  const b = makeAdapter('github_pr', PR_RESOLVED);
  const registry = new ImportSourceRegistry([a, b]);

  it('resolves adapters by id', () => {
    expect(registry.get('github_issue')).toBe(a);
    expect(registry.get('github_pr')).toBe(b);
  });
  it('reports membership and ids', () => {
    expect(registry.has('github_issue')).toBe(true);
    expect(registry.has('slack_message')).toBe(false);
    expect(registry.ids().sort()).toEqual(['github_issue', 'github_pr']);
  });
});

describe('ImportFromSourceUseCase.preview', () => {
  it('resolves an issue without creating anything', async () => {
    const store = makeTicketStore();
    const registry = new ImportSourceRegistry([makeAdapter('github_issue', ISSUE_RESOLVED)]);
    const uc = new ImportFromSourceUseCase(registry, store as never, makeLogger() as never);

    const preview = await uc.preview('https://github.com/Evaneos/Fleex/issues/12');

    expect(preview.sourceId).toBe('github_issue');
    expect(preview.ref).toBe('Evaneos/Fleex#12');
    expect(preview.title).toBe('Fix the thing');
    expect(preview.tags).toEqual(['bug']);
    expect(preview.repo).toEqual({ org: 'Evaneos', name: 'Fleex' });
    expect(preview.existingTickets).toEqual([]);
    // Preview NEVER creates or records anything.
    expect(store.createTicket).not.toHaveBeenCalled();
    expect(store.saveActivity).not.toHaveBeenCalled();
  });

  it('reports a PR head branch, fork flag and suggested type', async () => {
    const registry = new ImportSourceRegistry([makeAdapter('github_pr', PR_RESOLVED)]);
    const uc = new ImportFromSourceUseCase(registry, makeTicketStore() as never, makeLogger() as never);

    const preview = await uc.preview('https://github.com/Evaneos/Fleex/pull/7');

    expect(preview.ref).toBe('evaneos/fleex#7');
    expect(preview.repo?.headRefName).toBe('feat/x');
    expect(preview.repo?.isCrossRepository).toBe(false);
    expect(preview.suggested?.type).toBe('review');
  });

  it('surfaces existing tickets, matching a PR link stored in mixed case', async () => {
    // WHY: backfill stored PR refs with original casing; the new ref is lowercased.
    // Preview must find historical tickets under either casing.
    const store = makeTicketStore({
      'Evaneos/Fleex#7': [{ id: 't1', displayId: 42, title: 'Old', status: 'doing', archivedAt: null }],
    });
    const registry = new ImportSourceRegistry([makeAdapter('github_pr', PR_RESOLVED)]);
    const uc = new ImportFromSourceUseCase(registry, store as never, makeLogger() as never);

    const preview = await uc.preview('https://github.com/Evaneos/Fleex/pull/7');

    expect(store.getTicketsLinkedTo).toHaveBeenCalledWith('github_pr', 'evaneos/fleex#7');
    expect(store.getTicketsLinkedTo).toHaveBeenCalledWith('github_pr', 'Evaneos/Fleex#7');
    expect(preview.existingTickets).toEqual([
      { id: 't1', displayId: 42, title: 'Old', status: 'doing', archived: false },
    ]);
  });

  it('rejects an unrecognized input with IMPORT_INVALID_INPUT', async () => {
    const uc = new ImportFromSourceUseCase(new ImportSourceRegistry([]), makeTicketStore() as never, makeLogger() as never);
    await expect(uc.preview('just a title')).rejects.toBeInstanceOf(ImportError);
    await expect(uc.preview('just a title')).rejects.toMatchObject({ code: 'IMPORT_INVALID_INPUT' });
  });

  it('rejects a missing / non-string input with IMPORT_INVALID_INPUT (not a raw 500)', async () => {
    const uc = new ImportFromSourceUseCase(new ImportSourceRegistry([]), makeTicketStore() as never, makeLogger() as never);
    // The route body is unvalidated, so `input` can arrive undefined; it must map
    // to a 422 code, not a TypeError bubbling up as a 500.
    await expect(uc.preview(undefined as unknown as string)).rejects.toMatchObject({ code: 'IMPORT_INVALID_INPUT' });
    expect(() => uc.detect({} as unknown as string)).toThrow(ImportError);
  });

  it('forwards the abort signal to the adapter', async () => {
    const adapter = makeAdapter('slack_message', { title: 't', description: 'd', tags: [], links: [] });
    const uc = new ImportFromSourceUseCase(new ImportSourceRegistry([adapter]), makeTicketStore() as never, makeLogger() as never);
    const ac = new AbortController();

    await uc.preview('https://acme.slack.com/archives/C0123ABCD/p1700000000123456', { signal: ac.signal });

    expect(adapter.lastOpts?.signal).toBe(ac.signal);
  });
});

describe('ImportFromSourceUseCase.import', () => {
  it('creates a ticket with source + repository links, metadata, default backlog status', async () => {
    const store = makeTicketStore();
    const registry = new ImportSourceRegistry([makeAdapter('github_issue', ISSUE_RESOLVED)]);
    const uc = new ImportFromSourceUseCase(registry, store as never, makeLogger() as never);

    const match = { sourceId: 'github_issue', ref: 'Evaneos/Fleex#12', url: 'u', label: '#12', display: 'd', params: { org: 'Evaneos', name: 'Fleex', number: 12 } } as const;
    const ticket = await uc.import(match, 'board-1');

    expect(ticket.status).toBe('backlog');
    expect(ticket.boardId).toBe('board-1');
    expect(ticket.links.map((l) => l.type).sort()).toEqual(['github_issue', 'repository']);
    expect(ticket.links.find((l) => l.type === 'repository')?.ref).toBe('Evaneos/Fleex');
    expect(ticket.githubMetadata?.state).toBe('OPEN');
    expect(store.createTicket).toHaveBeenCalledTimes(1);
    expect(store.saveActivity).toHaveBeenCalledTimes(1);
  });

  it('applies the suggested type for a PR and lets an explicit type win', async () => {
    const store = makeTicketStore();
    const registry = new ImportSourceRegistry([makeAdapter('github_pr', PR_RESOLVED)]);
    const uc = new ImportFromSourceUseCase(registry, store as never, makeLogger() as never);
    const match = { sourceId: 'github_pr', ref: 'evaneos/fleex#7', url: 'u', label: '#7', display: 'd', params: { org: 'Evaneos', name: 'Fleex', number: 7 } } as const;

    const suggested = await uc.import(match, 'board-1');
    expect(suggested.type).toBe('review');

    const explicit = await uc.import(match, 'board-1', { type: 'fix' });
    expect(explicit.type).toBe('fix');
  });
});

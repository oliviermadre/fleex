/**
 * `fleex ticket list` must stay cheap for an LLM caller.
 *
 * One `ticket list --json` call returned >1M tokens: every field of every
 * ticket, done/cancelled included, no cap. Because tool results stay in the
 * conversation, one such call poisons every later turn. These tests pin the
 * guard-rails: slim `--json`, done/cancelled hidden by default, a default cap,
 * and a visible notice whenever rows were dropped so the caller is never
 * silently misled into thinking it saw everything.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:1234',
  apiGet: vi.fn(),
}));

vi.mock('../../src/commands/board/_shared.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/commands/board/_shared.ts')>()),
  resolveBoardId: async (ref: string) => ref,
}));

import { setJsonMode } from '../../src/core/colors.ts';
import { apiGet } from '../../src/core/api.ts';
import listDef, { selectTickets, parseLimit, type Ticket } from '../../src/commands/ticket/list/index.ts';

const day = (n: number) => new Date(Date.UTC(2026, 9, n)).toISOString();

function ticket(displayId: number, status: string, boardId = 'b1', updated = displayId): Ticket & Record<string, unknown> {
  return {
    id: `uuid-${boardId}-${displayId}`,
    displayId,
    boardId,
    title: `Ticket ${displayId}`,
    status,
    priority: 'high',
    type: 'feature',
    tags: ['cli'],
    assignee: displayId % 2 ? 'builder' : null,
    updatedAt: day(updated),
    // Heavy fields that must never leak into slim JSON:
    description: 'x'.repeat(5000),
    links: [{ type: 'github_pr', ref: 'org/repo#1' }],
    githubMetadata: { foo: 'bar' },
    createdAt: day(1),
  };
}

const FIXTURE = [
  ticket(1, 'done'),
  ticket(2, 'cancelled'),
  ticket(3, 'doing'),
  ticket(4, 'todo'),
  ticket(5, 'done'),
  ticket(6, 'backlog', 'b2'),
  ticket(7, 'reviewing', 'b2'),
  ticket(8, 'done', 'b2'),
];

const BOARDS = [{ id: 'b1', name: 'Alpha' }, { id: 'b2', name: 'Beta' }];
const EPICS = [{ id: 'e1', name: 'Perf', emoji: '🚀' }];
const MEMBERSHIPS = [{ ticketId: 'uuid-b1-3', groupId: 'e1' }];

function mockApi(tickets: unknown[] = FIXTURE) {
  vi.mocked(apiGet).mockImplementation(async (url: string) => {
    if (url.includes('/api/tickets')) return structuredClone(tickets);
    if (url.includes('/api/epics/memberships')) return MEMBERSHIPS;
    if (url.includes('/api/epics')) return EPICS;
    if (url.includes('/api/boards')) return BOARDS;
    throw new Error(`unexpected url ${url}`);
  });
}

class ExitError extends Error { constructor(public code: number) { super(`exit ${code}`); } }

async function run(opts: Record<string, unknown>): Promise<{ out: string; errOut: string; code: number | null }> {
  const out: string[] = [];
  const errOut: string[] = [];
  const so = process.stdout.write;
  const se = process.stderr.write;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stdout.write = ((ch: any) => { out.push(String(ch)); return true; }) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  process.stderr.write = ((ch: any) => { errOut.push(String(ch)); return true; }) as any;
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new ExitError(code); }) as never);
  let code: number | null = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (listDef.action as any)(opts);
  } catch (e) {
    if (e instanceof ExitError) code = e.code; else throw e;
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
    exit.mockRestore();
  }
  return { out: out.join(''), errOut: errOut.join(''), code };
}

describe('selectTickets', () => {
  it('hides done/cancelled by default and counts them', () => {
    const sel = selectTickets(FIXTURE, { limit: 0 });
    expect(sel.tickets.map((t) => t.status)).not.toContain('done');
    expect(sel.tickets.map((t) => t.status)).not.toContain('cancelled');
    expect(sel.hidden).toEqual({ done: 3, cancelled: 1 });
    expect(sel.total).toBe(4);
  });

  it('an explicit --status always wins, even for done', () => {
    const sel = selectTickets(FIXTURE, { statuses: ['done'], all: false, limit: 0 });
    expect(sel.tickets.every((t) => t.status === 'done')).toBe(true);
    expect(sel.hidden).toBeNull();
  });

  it('--status doing --all returns only doing (--all does not widen an explicit filter)', () => {
    const sel = selectTickets(FIXTURE, { statuses: ['doing'], all: true, limit: 0 });
    expect(sel.tickets.map((t) => t.displayId)).toEqual([3]);
  });

  it('--all returns every status with no hidden counts', () => {
    const sel = selectTickets(FIXTURE, { all: true, limit: 0 });
    expect(sel.tickets).toHaveLength(8);
    expect(sel.hidden).toBeNull();
  });

  it('the cap keeps the most recently updated tickets, not the oldest ids', () => {
    // 120 eligible tickets; updatedAt grows with the id, so the newest are 71..120.
    const many = Array.from({ length: 120 }, (_, i) => ticket(i + 1, 'todo'))
      .map((t, i) => ({ ...t, updatedAt: new Date(Date.UTC(2026, 0, 1) + i * 60_000).toISOString() }));
    const sel = selectTickets(many, { limit: 50 });
    expect(sel.tickets).toHaveLength(50);
    expect(sel.truncated).toBe(true);
    expect(sel.total).toBe(120);
    expect(Math.min(...sel.tickets.map((t) => t.displayId))).toBe(71);
    expect(selectTickets(many, { limit: 10 }).tickets).toHaveLength(10);
    expect(selectTickets(many, { limit: 0 }).tickets).toHaveLength(120);
  });
});

describe('parseLimit', () => {
  it('defaults to 50', () => { expect(parseLimit(undefined)).toBe(50); });
  it('accepts 0 as "no limit"', () => { expect(parseLimit('0')).toBe(0); });
});

describe('ticket list --json (slim)', () => {
  beforeEach(() => { setJsonMode(true); vi.clearAllMocks(); mockApi(); });
  afterEach(() => { setJsonMode(false); });

  it('emits one JSON envelope whose tickets carry exactly the 11 grid fields', async () => {
    const { out, code } = await run({});
    expect(code).toBeNull();
    const parsed = JSON.parse(out);
    expect(Object.keys(parsed).sort()).toEqual(['hidden', 'notice', 'returned', 'tickets', 'total', 'truncated']);
    for (const t of parsed.tickets) {
      expect(Object.keys(t).sort()).toEqual(
        ['assignee', 'board', 'displayId', 'epic', 'id', 'priority', 'status', 'tags', 'title', 'type', 'updatedAt'],
      );
    }
    expect(out).not.toContain('description');
    expect(out).not.toContain('githubMetadata');
  });

  it('reports hidden done/cancelled so the caller knows the list is filtered', async () => {
    const parsed = JSON.parse((await run({})).out);
    expect(parsed.hidden).toEqual({ done: 3, cancelled: 1 });
    expect(parsed.notice).toContain('3 done / 1 cancelled hidden');
    expect(parsed.tickets.map((t: { status: string }) => t.status)).not.toContain('done');
  });

  it('labels board names and the first epic, null when absent', async () => {
    const parsed = JSON.parse((await run({})).out);
    const t3 = parsed.tickets.find((t: { displayId: number }) => t.displayId === 3);
    const t4 = parsed.tickets.find((t: { displayId: number }) => t.displayId === 4);
    expect(t3.board).toBe('Alpha');
    expect(t3.epic).toBe('🚀 Perf');
    expect(t4.epic).toBeNull();
    expect(t4.assignee).toBeNull();
  });

  it('honours --limit and flags truncation', async () => {
    const parsed = JSON.parse((await run({ limit: '2' })).out);
    expect(parsed.returned).toBe(2);
    expect(parsed.total).toBe(4);
    expect(parsed.truncated).toBe(true);
    expect(parsed.notice).toContain('2 of 4 shown');
  });

  it('--status done returns only done, with no hidden notice', async () => {
    const parsed = JSON.parse((await run({ status: 'done' })).out);
    expect(parsed.tickets.every((t: { status: string }) => t.status === 'done')).toBe(true);
    expect(parsed.hidden).toBeNull();
    expect(parsed.notice).toBeNull();
  });

  it('--status doing,done returns both', async () => {
    const parsed = JSON.parse((await run({ status: 'doing,done' })).out);
    expect(new Set(parsed.tickets.map((t: { status: string }) => t.status))).toEqual(new Set(['doing', 'done']));
  });

  it('returns an empty envelope (still pure JSON) when everything was hidden', async () => {
    mockApi([ticket(1, 'done')]);
    const { out } = await run({});
    const parsed = JSON.parse(out);
    expect(parsed.tickets).toEqual([]);
    expect(parsed.hidden).toEqual({ done: 1, cancelled: 0 });
  });

  it.each(['-1', '1.5', 'abc'])('rejects --limit %s with exit 1 and a JSON error', async (bad) => {
    const { out, code } = await run({ limit: bad });
    expect(code).toBe(1);
    expect(JSON.parse(out)).toEqual({ ok: false, error: '--limit must be an integer >= 0' });
  });

  it('rejects an unknown status, listing the valid ones', async () => {
    const { out, code } = await run({ status: 'foo' });
    expect(code).toBe(1);
    expect(JSON.parse(out).error).toMatch(/Unknown status 'foo'.*backlog\|todo\|doing\|reviewing\|done\|cancelled/);
  });
});

describe('ticket list --json-full', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); });

  it('--all --limit 0 reproduces the old --json output exactly (same objects, same order)', async () => {
    const { out } = await run({ jsonFull: true, all: true, limit: '0' });
    expect(JSON.parse(out)).toEqual(FIXTURE);
  });

  it('keeps stdout pure JSON and sends the filter notice to stderr', async () => {
    const { out, errOut } = await run({ jsonFull: true });
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.every((t: { status: string }) => !['done', 'cancelled'].includes(t.status))).toBe(true);
    expect(errOut).toContain('3 done / 1 cancelled hidden');
  });

  it('wins over --json', async () => {
    setJsonMode(true);
    try {
      const parsed = JSON.parse((await run({ jsonFull: true, all: true, limit: '0' })).out);
      expect(Array.isArray(parsed)).toBe(true);
    } finally { setJsonMode(false); }
  });
});

describe('ticket list (grid)', () => {
  beforeEach(() => { vi.clearAllMocks(); mockApi(); });

  it('hides done/cancelled and says so in the footer', async () => {
    const { out } = await run({});
    expect(out).toContain('4 ticket(s)');
    expect(out).toContain('(3 done / 1 cancelled hidden — use --status or --all)');
    expect(out).not.toMatch(/#1\s/);
  });

  it('shows the truncation in the footer', async () => {
    const { out } = await run({ limit: '1', all: true });
    expect(out).toContain('1 ticket(s) (of 8 — use --limit 0 for all)');
  });

  it('explains an empty result caused by the default hiding', async () => {
    mockApi([ticket(1, 'done'), ticket(2, 'done')]);
    const { out } = await run({});
    expect(out).toContain('No tickets found.');
    expect(out).toContain('(2 done hidden — use --status or --all)');
  });
});

describe('ticket list --help', () => {
  it('warns that --json-full is token-expensive and documents --limit', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opts: Array<{ flags: string; description: string }> = [];
    listDef.setup!({ option: (flags: string, description: string) => { opts.push({ flags, description }); } } as never);
    const full = opts.find((o) => o.flags === '--json-full')!;
    expect(full.description).toContain('WARNING');
    expect(full.description).toContain('tokens');
    const limit = opts.find((o) => o.flags.startsWith('--limit'))!;
    expect(limit.description).toContain('0 = no limit');
    expect(limit.description).toContain('50');
  });
});

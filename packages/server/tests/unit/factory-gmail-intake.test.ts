/**
 * The Gmail intakes: the gogcli adapter of `MailSourcePort` (a fake `gog`, never the real binary nor a mailbox), and
 * the puller that hands what it reads to the floor.
 */
import { describe, it, expect } from 'vitest';
import { GogMailSource, gmailThreadUrl, mapGogMessage, pullQuery } from '../../src/infrastructure/google/gog-mail.source.js';
import type { GogResult } from '../../src/infrastructure/google/google-calendar.client.js';
import { MailSourceError, type MailMessage, type MailSourcePort } from '../../src/factory/mail-source.port.js';
import { IntakePuller, PULL_OVERLAP_MS, mailToItem } from '../../src/factory/intake-puller.js';
import type { IntakePullRow, IntakeSpec, ItemInput } from '../../src/factory/types.js';

const ok = (json: unknown): GogResult => ({ code: 0, stdout: JSON.stringify(json), stderr: '' });
const NOW = Date.parse('2026-11-20T10:00:00.000Z');

function fakeGog(handler: (args: string[]) => GogResult) {
  const calls: string[][] = [];
  return { calls, run: async (args: string[]) => { calls.push(args); return handler(args); } };
}

describe('GogMailSource', () => {
  it('runs one read-only messages search with the query and the cursor, and maps what gog writes, oldest first', async () => {
    const gog = fakeGog(() => ok({
      messages: [
        { id: 'm2', threadId: 't1', internalDateIso: '2026-11-20T09:30:00+01:00', from: 'Ana <ana@acme.com>', to: 'me@x.com', subject: 'Re: cart', labels: ['INBOX', 'IMPORTANT'], body: 'second\r\n\r\n\r\n\r\nline', attachments: [{ filename: 'a.pdf' }] },
        { id: 'm1', threadId: 't1', internalDateIso: '2026-11-20T08:00:00Z', from: 'ana@acme.com', subject: 'cart' },
        { id: 'broken', internalDateIso: '2026-11-20T08:00:00Z' },
      ],
      nextPageToken: '',
    }));
    const src = new GogMailSource({ run: gog.run, account: 'me@x.com' });
    const out = await src.search('from:@acme.com -label:done', new Date('2026-11-20T08:00:00.000Z'));
    expect(gog.calls[0]).toEqual([
      '--json', '--no-input', '--readonly', '--color=never', '--account', 'me@x.com',
      'gmail', 'messages', 'search', '--all', '--max', '100', '--include-body', '--include-recipients', '--include-attachments',
      '--', `(from:@acme.com -label:done) after:${Date.parse('2026-11-20T08:00:00.000Z') / 1000}`,
    ]);
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(out[1]).toEqual({
      id: 'm2', threadId: 't1', at: '2026-11-20T08:30:00.000Z', from: 'Ana <ana@acme.com>', to: 'me@x.com', cc: '', subject: 'Re: cart',
      body: 'second\n\nline', labels: ['INBOX', 'IMPORTANT'], attachments: 1, url: 'https://mail.google.com/mail/?authuser=me%40x.com#all/t1',
    });
  });

  it('says why it cannot read: not installed, not authorized, slowed down', async () => {
    const missing = new GogMailSource({ run: async () => ({ code: 127, stdout: '', stderr: '', notFound: true }) });
    await expect(missing.search('', new Date(NOW))).rejects.toMatchObject({ kind: 'not_installed' });
    const noAuth = new GogMailSource({ run: async () => ({ code: 4, stdout: JSON.stringify({ error: { class: 'auth', message: 'no token for gmail' } }), stderr: '' }) });
    await expect(noAuth.search('', new Date(NOW))).rejects.toMatchObject({ kind: 'not_connected', message: expect.stringContaining('no token for gmail') });
    const slow = new GogMailSource({ run: async () => ({ code: 7, stdout: '', stderr: 'rate limited' }) });
    await expect(slow.search('', new Date(NOW))).rejects.toBeInstanceOf(MailSourceError);
    await expect(slow.search('', new Date(NOW))).rejects.toMatchObject({ kind: 'rate_limited' });
  });

  it('tells its status: the version, and whether Gmail answers; kept a minute', async () => {
    let authorized = false;
    const gog = fakeGog((args) => (args[0] === '--version' ? { code: 0, stdout: 'v0.47.1 (abc)\n', stderr: '' } : args.includes('--ids-only') ? { code: 2, stdout: '', stderr: 'unknown flag --ids-only' } : authorized ? ok({ messages: [] }) : { code: 4, stdout: '', stderr: 'auth required' }));
    let now = NOW;
    const src = new GogMailSource({ run: gog.run, account: null, now: () => now });
    expect(await src.status()).toMatchObject({ provider: 'gogcli', installed: true, version: 'v0.47.1', connected: false, error: expect.stringContaining('auth required'), setupUrl: expect.stringContaining('gogcli') });
    authorized = true;
    expect((await src.status()).connected).toBe(false);          // cached
    expect((await src.status(true)).connected).toBe(true);       // asked again
    now += 61_000;
    expect((await src.status()).connected).toBe(true);
    /* the smallest read every release knows: no --ids-only, which came in gogcli 0.48 */
    expect(gog.calls.find((a) => a.includes('messages'))).toEqual(['--json', '--no-input', '--readonly', '--color=never', 'gmail', 'messages', 'search', '--max', '1', '--', 'newer_than:1d']);
    const none = new GogMailSource({ run: async () => ({ code: 127, stdout: '', stderr: '', notFound: true }) });
    expect(await none.status()).toMatchObject({ installed: false, connected: false, version: null });
  });

  it('runs again without a flag an older gogcli does not know, and does not ask for it again', async () => {
    const gog = fakeGog((args) => (args.includes('--include-recipients')
      ? { code: 2, stdout: '', stderr: 'gog: error: unknown flag --include-recipients, did you mean "--include-body"?' }
      : ok({ messages: [{ id: 'm1', threadId: 't1', internalDateIso: '2026-11-20T08:00:00Z', subject: 'hi' }] })));
    const src = new GogMailSource({ run: gog.run, account: null });
    expect((await src.search('', new Date(NOW))).map((m) => m.id)).toEqual(['m1']);
    expect((await src.search('', new Date(NOW))).map((m) => m.id)).toEqual(['m1']);
    expect(gog.calls.map((a) => a.includes('--include-recipients'))).toEqual([true, false, false]);
    expect(gog.calls[1]).toContain('--include-attachments');
    /* any other refusal is the pull's failure */
    const broken = new GogMailSource({ run: async () => ({ code: 2, stdout: '', stderr: 'unknown flag --include-body' }) });
    await expect(broken.search('', new Date(NOW))).rejects.toMatchObject({ kind: 'failed' });
  });

  it('builds the search and the link a person opens', () => {
    const since = new Date('2026-11-20T08:00:00.500Z');
    expect(pullQuery('', since)).toBe(`after:${Math.floor(since.getTime() / 1000)}`);
    expect(pullQuery(' a OR b ', since)).toBe(`(a OR b) after:${Math.floor(since.getTime() / 1000)}`);
    expect(gmailThreadUrl('t9', null)).toBe('https://mail.google.com/mail/u/0/#all/t9');
    expect(mapGogMessage({ id: 'x', threadId: 't', date: 'not a date' }, null)).toBeNull();
  });
});

describe('IntakePuller', () => {
  const mailMsg = (id: string, at: string, over: Partial<MailMessage> = {}): MailMessage => ({ id, threadId: `t-${id}`, at, from: 'ana@acme.com', to: 'me@x.com', cc: '', subject: `s ${id}`, body: 'b', labels: ['INBOX'], attachments: 0, url: null, ...over });

  function setup(opts: { pull?: IntakePullRow | null; search?: MailSourcePort['search'] } = {}) {
    const spec = { id: 'in1', kind: 'intake', source: 'gmail', query: 'is:important', everySec: 300 } as IntakeSpec;
    let pull: IntakePullRow | null = opts.pull ?? null;
    const ingested: { input: ItemInput; intakeId?: string }[] = [], searches: { query: string; since: Date }[] = [];
    let now = NOW;
    const engine = {
      pulledIntakes: () => [{ spec, pull }],
      recordPull: async (intakeId: string, lastPulledAt: string | null, error: string | null) => { pull = { intakeId, floorId: 'default', lastPulledAt, error, updatedAt: new Date(now).toISOString() }; },
      ingest: async (input: ItemInput, o: { intakeId?: string } = {}) => { ingested.push({ input, intakeId: o.intakeId }); return { itemId: 'x', status: ingested.length === 2 ? 'updated' as const : 'new' as const }; },
    };
    const mail: MailSourcePort = {
      provider: 'fake', status: async () => ({ provider: 'fake', installed: true, version: null, connected: true, account: null, error: null, setupUrl: '' }),
      search: opts.search ?? (async (query, since) => { searches.push({ query, since }); return [mailMsg('a', '2026-11-20T09:58:00.000Z'), mailMsg('b', '2026-11-20T09:59:00.000Z')]; }),
    };
    const puller = new IntakePuller({ engine: engine as never, mail, logger: { warn: () => {} }, now: () => now });
    return { puller, ingested, searches, get pull() { return pull; }, advance: (ms: number) => { now += ms; } };
  }

  it('starts from the first time it sees an intake: what was in the mailbox before stays there', async () => {
    const s = setup();
    expect(await s.puller.pull('in1')).toMatchObject({ pulled: 0, error: null });
    expect(s.searches).toEqual([]);
    expect(s.pull).toMatchObject({ lastPulledAt: new Date(NOW).toISOString(), error: null });
  });

  it('asks for what came since the cursor (looking back a little), and hands every message to the floor, naming the intake', async () => {
    const last = '2026-11-20T09:55:00.000Z';
    const s = setup({ pull: { intakeId: 'in1', floorId: 'default', lastPulledAt: last, error: null, updatedAt: last } });
    expect(await s.puller.pull('in1')).toEqual({ pulled: 2, new: 1, updated: 1, moved: 0, error: null });
    expect(s.searches).toEqual([{ query: 'is:important', since: new Date(Date.parse(last) - PULL_OVERLAP_MS) }]);
    expect(s.ingested.map((x) => [x.input.key, x.intakeId])).toEqual([['t-a', 'in1'], ['t-b', 'in1']]);
    expect(s.pull).toMatchObject({ lastPulledAt: new Date(NOW).toISOString(), error: null });
  });

  it('keeps its cursor when the mailbox cannot be read, says why, and waits its interval before asking again', async () => {
    const last = '2026-11-20T09:55:00.000Z';
    let calls = 0;
    const s = setup({ pull: { intakeId: 'in1', floorId: 'default', lastPulledAt: last, error: null, updatedAt: last }, search: async () => { calls++; throw new MailSourceError('Gmail is not authorized in gogcli', 'not_connected'); } });
    await s.puller.tick();
    expect(calls).toBe(1);
    expect(s.pull).toMatchObject({ lastPulledAt: last, error: 'Gmail is not authorized in gogcli' });
    await s.puller.tick();
    expect(calls).toBe(1);
    s.advance(301_000);
    await s.puller.tick();
    expect(calls).toBe(2);
  });

  it('turns a message into an item of its thread, with the fields of a Gmail item', () => {
    expect(mailToItem({ id: 'm', threadId: 't', at: '2026-11-20T09:00:00.000Z', from: 'Ana', to: 'me', cc: '', subject: 'Hi', body: 'text', labels: ['INBOX'], attachments: 2, url: 'https://mail.google.com/x' })).toEqual({
      source: 'gmail', key: 't', title: 'Hi', author: 'Ana', excerpt: 'text', url: 'https://mail.google.com/x', at: '2026-11-20T09:00:00.000Z',
      fields: { to: 'me', labels: ['INBOX'], attachment: true },
    });
  });
});

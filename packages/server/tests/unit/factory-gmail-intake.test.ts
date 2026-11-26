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
      body: 'second\n\nline', html: null, labels: ['INBOX', 'IMPORTANT'], attachments: 1, url: 'https://mail.google.com/mail/?authuser=me%40x.com#all/t1',
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
    expect(gog.calls.filter((a) => !a.includes('--body-format')).map((a) => a.includes('--include-recipients'))).toEqual([true, false, false]);
    expect(gog.calls[1]).toContain('--include-attachments');
    /* any other refusal is the pull's failure */
    const broken = new GogMailSource({ run: async () => ({ code: 2, stdout: '', stderr: 'unknown flag --include-body' }) });
    await expect(broken.search('', new Date(NOW))).rejects.toMatchObject({ kind: 'failed' });
  });

  it('keeps a mail\'s text and its HTML part apart: an HTML-only mail is read as text, and the HTML comes from a second search', async () => {
    const HTML = '<html><head><style>p{color:red}</style></head><body><div>Hello&nbsp;Ana,</div><p>Your <a href="https://x.com/i/42">invoice</a> is ready.</p><ul><li>one</li><li>two</li></ul></body></html>';
    const gog = fakeGog((args) => ok({ messages: args.includes('--body-format')
      ? [{ id: 'm1', threadId: 't1', internalDateIso: '2026-11-20T08:00:00Z', body: HTML }, { id: 'm2', threadId: 't2', internalDateIso: '2026-11-20T08:00:00Z', body: '<div><b>Hi</b></div><p>both parts</p><br>' }]
      : [{ id: 'm1', threadId: 't1', internalDateIso: '2026-11-20T08:00:00Z', body: HTML }, { id: 'm2', threadId: 't2', internalDateIso: '2026-11-20T08:00:00Z', body: 'Hi\nboth parts' }] }));
    const [a, b] = await new GogMailSource({ run: gog.run, account: null }).search('', new Date(NOW));
    expect(a!.body).toBe('Hello Ana,\n\nYour invoice (https://x.com/i/42) is ready.\n\n- one\n- two');
    expect(a!.html).toBe(HTML);
    expect(b!.body).toBe('Hi\nboth parts');                  // the text part, as sent
    expect(b!.html).toContain('<b>Hi</b>');
    expect(gog.calls[1]).toContain('html');
    /* the HTML search failing leaves the text */
    let n = 0;
    const flaky = new GogMailSource({ run: async (args) => (args.includes('--body-format') ? { code: 1, stdout: '', stderr: 'boom' } : (n++, ok({ messages: [{ id: 'm2', threadId: 't2', internalDateIso: '2026-11-20T08:00:00Z', body: 'plain' }] }))) });
    expect((await flaky.search('', new Date(NOW)))[0]).toMatchObject({ body: 'plain', html: null });
    expect(n).toBe(1);
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
    expect(mailToItem({ id: 'm', threadId: 't', at: '2026-11-20T09:00:00.000Z', from: 'Ana', to: 'me', cc: '', subject: 'Hi', body: 'text', html: '<p>text</p>', labels: ['INBOX'], attachments: 2, url: 'https://mail.google.com/x' })).toEqual({
      source: 'gmail', key: 't', title: 'Hi', author: 'Ana', excerpt: 'text', url: 'https://mail.google.com/x', at: '2026-11-20T09:00:00.000Z', body: { text: 'text', html: '<p>text</p>' },
      fields: { to: 'me', labels: ['INBOX'], attachment: true },
    });
  });
});

describe('an HTML body as text', () => {
  it('tells HTML from text, and reads it as lines, links and bullets', async () => {
    const { htmlToText, looksLikeHtml } = await import('@fleex/shared');
    expect(looksLikeHtml('Hi <b>you</b>, 3 < 4')).toBe(false);
    expect(looksLikeHtml('<!DOCTYPE html><html>')).toBe(true);
    expect(looksLikeHtml('<div>a</div><div>b</div><br>')).toBe(true);
    expect(htmlToText('<table><tr><td>Total</td><td>&euro;12&#44;50</td></tr></table><p>See <a href="https://a.b">https://a.b</a></p><!-- x --><script>alert(1)</script>')).toBe('Total €12,50\n\nSee https://a.b');
  });
});

describe('the brief of a station that runs on a mail', () => {
  it('gives the whole of the message when it was kept, its HTML part read as text when that is all, else the first lines', async () => {
    const { itemBrief } = await import('../../src/factory/item-brief.js');
    const item = { id: 'i', floorId: 'default', source: 'gmail', sourceKey: 't', title: 'Invoice', author: 'Ana', excerpt: '<div>Hello</div><p>old</p><br>', url: null, tags: [], fields: {}, messages: 1, lastActivityAt: '2026-11-20T08:00:00.000Z', intakeId: null, machineId: null, state: null, archivedAt: null, archivedReason: null, createdAt: '', updatedAt: '' } as never;
    expect(itemBrief(item, [], { text: 'The whole text, line 2', html: null })).toContain('The whole text, line 2');
    expect(itemBrief(item, [], { text: 'The whole text', html: null })).toContain('its latest message, whole');
    expect(itemBrief(item, [], { text: '', html: '<p>From <b>HTML</b></p>' })).toContain('From HTML');
    const old = itemBrief(item);
    expect(old).toContain('Hello\n\nold');
    expect(old).not.toContain('<div>');
  });
});

describe('a mail thread, whole', () => {
  const b64 = (s: string, enc: BufferEncoding = 'utf8') => Buffer.from(s, enc).toString('base64url');
  const msg = (id: string, at: number, payload: unknown) => ({ id, threadId: 't9', internalDate: String(at), labelIds: ['INBOX'], payload });

  it('reads every message of a thread from the API\'s parts: the text part, the HTML part, a charset, attachments', async () => {
    const long = 'x'.repeat(30_000);
    const thread = { messages: [
      msg('m2', Date.parse('2026-11-20T10:00:00Z'), { mimeType: 'multipart/mixed', headers: [{ name: 'From', value: 'Bob' }, { name: 'Subject', value: 'Re: devis' }], parts: [
        { mimeType: 'multipart/alternative', parts: [
          { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset="UTF-8"' }], body: { data: b64(`Réponse complète ${long}`) } },
          { mimeType: 'text/html', body: { data: b64(`<div>Réponse <b>complète</b></div><p>${long}</p>`) } },
        ] },
        { mimeType: 'application/pdf', filename: 'devis.pdf', body: { attachmentId: 'a1', size: 100 } },
      ] }),
      msg('m1', Date.parse('2026-11-19T09:00:00Z'), { mimeType: 'text/html', headers: [{ name: 'From', value: 'Ana' }, { name: 'Content-Type', value: 'text/html; charset=ISO-8859-1' }], body: { data: b64('<div>Début</div><p>du fil</p><br>', 'latin1') } }),
    ] };
    const gog = fakeGog(() => ok({ thread, downloaded: [] }));
    const all = await new GogMailSource({ run: gog.run, account: null }).thread('t9');
    expect(gog.calls[0]).toEqual(['--json', '--no-input', '--readonly', '--color=never', 'gmail', 'thread', 'get', 't9']);
    expect(all.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(all[0]).toMatchObject({ from: 'Ana', body: 'Début\n\ndu fil', html: '<div>Début</div><p>du fil</p><br>' });
    expect(all[1]!.body.length).toBeGreaterThan(30_000);                              // whole, nothing cut
    expect(all[1]).toMatchObject({ from: 'Bob', subject: 'Re: devis', attachments: 1 });
    expect(all[1]!.html).toContain('<b>complète</b>');
  });
});

describe('the brief of a station that runs on a conversation', () => {
  it('gives every message, oldest first, and leaves the oldest out past its length', async () => {
    const { itemBrief } = await import('../../src/factory/item-brief.js');
    const item = { id: 'i', floorId: 'default', source: 'gmail', sourceKey: 't', title: 'Devis', author: 'Ana', excerpt: 'cut', url: null, tags: [], fields: {}, messages: 3, lastActivityAt: '', intakeId: null, machineId: null, state: null, archivedAt: null, archivedReason: null, createdAt: '', updatedAt: '' } as never;
    const brief = itemBrief(item, [], null, [{ from: 'Ana', at: '2026-11-19', text: 'Can you quote?' }, { from: 'Me', at: '2026-11-20', text: 'Sure, 1200 €' }, { from: 'Ana', at: '2026-11-21', text: 'Rouge, enfin aubergine' }]);
    expect(brief).toContain('## The conversation');
    expect(brief.indexOf('Can you quote?')).toBeLessThan(brief.indexOf('Rouge, enfin aubergine'));
    expect(brief).not.toContain('cut');
    const big = itemBrief(item, [], null, Array.from({ length: 6 }, (_, i) => ({ from: `p${i}`, at: `d${i}`, text: `${i}`.repeat(15_000) })));
    expect(big).toContain('The 2 oldest are left out');
    expect(big).toContain('5'.repeat(15_000));
    expect(big).not.toContain('0'.repeat(15_000));
  });
});

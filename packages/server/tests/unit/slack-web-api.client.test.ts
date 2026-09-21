import { describe, it, expect, vi } from 'vitest';
import { SlackWebApiClient, SlackApiError } from '../../src/infrastructure/adapters/slack-web-api.client.js';

const TOKEN = 'xoxp-secret-token';
const json = (body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) =>
  new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers });

function clientWith(...responses: Response[]) {
  const fetchFn = vi.fn(async () => responses.shift()!);
  return { client: new SlackWebApiClient(fetchFn as never), fetchFn };
}
const callOf = (fetchFn: ReturnType<typeof vi.fn>, i = 0) => fetchFn.mock.calls[i] as unknown as [string, RequestInit];

describe('SlackWebApiClient', () => {
  it('sends the token in the Authorization header and never in the URL', async () => {
    const { client, fetchFn } = clientWith(json({ ok: true, messages: [] }));

    await client.fetchConversation(TOKEN, 'C1', '1.2');

    const [url, init] = callOf(fetchFn);
    expect(url).not.toContain(TOKEN);
    expect(url).toContain('conversations.replies?channel=C1&ts=1.2');
    expect((init.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
  });

  it('identifies the token: workspace subdomain (to match permalinks), user, scopes', async () => {
    const { client } = clientWith(
      json(
        { ok: true, team_id: 'T1', team: 'Evaneos', url: 'https://evaneos.slack.com/', user_id: 'U1', user: 'nas' },
        { headers: { 'x-oauth-scopes': 'channels:history, users:read' } },
      ),
    );

    expect(await client.authTest(TOKEN)).toEqual({
      teamId: 'T1', teamName: 'Evaneos', teamDomain: 'evaneos', userId: 'U1', userName: 'nas',
      scopes: ['channels:history', 'users:read'],
    });
  });

  it('follows the cursor so a long thread is read whole', async () => {
    const { client, fetchFn } = clientWith(
      json({ ok: true, messages: [{ ts: '1' }], response_metadata: { next_cursor: 'abc' } }),
      json({ ok: true, messages: [{ ts: '2' }], response_metadata: { next_cursor: '' } }),
    );

    const messages = await client.fetchConversation(TOKEN, 'C1', '1');

    expect(messages.map((m) => m.ts)).toEqual(['1', '2']);
    expect(callOf(fetchFn, 1)[0]).toContain('cursor=abc');
  });

  it("surfaces Slack's own refusal code, with the scope it wanted", async () => {
    const { client } = clientWith(json({ ok: false, error: 'missing_scope', needed: 'im:history' }));

    const err = await client.fetchConversation(TOKEN, 'D1', '1').catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SlackApiError);
    expect(err).toMatchObject({ code: 'missing_scope', needed: 'im:history' });
    expect(String((err as Error).message)).not.toContain(TOKEN);
  });

  it('tells a rate limit apart from a broken token', async () => {
    const { client } = clientWith(json({}, { status: 429 }));

    await expect(client.authTest(TOKEN)).rejects.toMatchObject({ code: 'ratelimited' });
  });

  it('resolves the names it can and shrugs off the ones it cannot', async () => {
    const { client } = clientWith(
      json({ ok: true, user: { name: 'ana', real_name: 'Ana P', profile: { display_name: 'Ana' } } }),
      json({ ok: false, error: 'missing_scope' }),
    );

    const names = await client.fetchUserNames(TOKEN, ['U1', 'U2']);

    expect([...names]).toEqual([['U1', 'Ana']]);
  });
});

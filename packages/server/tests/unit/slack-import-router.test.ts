import { describe, it, expect, vi } from 'vitest';
import type { ParsedSlackMessageUrl } from '@fleex/shared';
import { SlackImportRouter } from '../../src/infrastructure/adapters/slack-import-router.js';
import { SlackApiError } from '../../src/infrastructure/adapters/slack-web-api.client.js';
import type { SlackConnection } from '../../src/application/ports/slack-connection.port.js';
import type { SlackMessage } from '../../src/domain/services/slack-transcript.js';

const CONN: SlackConnection = {
  token: 'xoxp-secret', teamId: 'T1', teamName: 'Evaneos', teamDomain: 'evaneos',
  userId: 'U1', userName: 'nas', scopes: [], connectedAt: '2026-09-21T10:00:00.000Z',
};
const link = (over: Partial<ParsedSlackMessageUrl> = {}): ParsedSlackMessageUrl => ({
  workspace: 'evaneos', channelId: 'C1', ts: '1700000000.000100', threadTs: null,
  url: 'https://evaneos.slack.com/archives/C1/p1700000000000100', ...over,
});

function setup(opts: { connection?: SlackConnection | null; messages?: SlackMessage[] | Error; summary?: { title: string; synthesis: string } | null | Error } = {}) {
  const claude = { synthesizeThread: vi.fn(async () => ({ status: 'ok' as const, title: 'via claude', synthesis: 's' })) };
  const api = {
    fetchConversation: vi.fn(async () => {
      if (opts.messages instanceof Error) throw opts.messages;
      return opts.messages ?? [{ ts: '1700000000.000100', user: 'U1', text: 'Quota blew up' }];
    }),
    fetchUserNames: vi.fn(async () => new Map([['U1', 'Ana']])),
  };
  const synthesizer = {
    synthesize: vi.fn(async () => {
      if (opts.summary instanceof Error) throw opts.summary;
      return opts.summary === undefined ? { title: 'Alert before quota', synthesis: 'Ana reports…' } : opts.summary;
    }),
  };
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const router = new SlackImportRouter(
    { get: async () => (opts.connection === undefined ? CONN : opts.connection), save: vi.fn(), clear: vi.fn() },
    api as never, synthesizer, claude, logger,
  );
  return { router, claude, api, synthesizer, logger };
}

describe('SlackImportRouter', () => {
  it('reads Slack directly when a token is saved: no agent, no MCP round-trips', async () => {
    const { router, claude, api, synthesizer } = setup();

    const result = await router.synthesizeThread(link());

    expect(result).toEqual({ status: 'ok', title: 'Alert before quota', synthesis: 'Ana reports…' });
    expect(api.fetchConversation).toHaveBeenCalledWith('xoxp-secret', 'C1', '1700000000.000100', undefined);
    expect(synthesizer.synthesize).toHaveBeenCalledWith(expect.stringContaining('Ana: Quota blew up'), { signal: undefined });
    expect(claude.synthesizeThread).not.toHaveBeenCalled();
  });

  it('falls back to Claude when no token is saved', async () => {
    const { router, claude, api } = setup({ connection: null });

    expect(await router.synthesizeThread(link())).toMatchObject({ title: 'via claude' });
    expect(claude.synthesizeThread).toHaveBeenCalledTimes(1);
    expect(api.fetchConversation).not.toHaveBeenCalled();
  });

  it("falls back to Claude for a link from another workspace: the token can't see it", async () => {
    const { router, claude, api } = setup();

    await router.synthesizeThread(link({ workspace: 'other-co' }));

    expect(claude.synthesizeThread).toHaveBeenCalledTimes(1);
    expect(api.fetchConversation).not.toHaveBeenCalled();
  });

  it('asks Slack for the thread ROOT when the link points at a reply', async () => {
    const { router, api } = setup();

    await router.synthesizeThread(link({ ts: '1700000500.000900', threadTs: '1700000000.000100' }));

    expect(api.fetchConversation).toHaveBeenCalledWith('xoxp-secret', 'C1', '1700000000.000100', undefined);
  });

  it('does NOT quietly take the slow path when the saved token is broken — it says what to fix', async () => {
    // A silent fallback would hide a revoked token forever behind "Slack is slow again".
    const { router, claude } = setup({ messages: new SlackApiError('token_revoked') });

    const result = await router.synthesizeThread(link());

    expect(result.status).toBe('integration_unavailable');
    expect(result).toMatchObject({ detail: expect.stringMatching(/Settings → Connectors/) });
    expect(claude.synthesizeThread).not.toHaveBeenCalled();
  });

  it('names the missing scope', async () => {
    const { router } = setup({ messages: new SlackApiError('missing_scope', 'im:history') });

    expect(await router.synthesizeThread(link())).toMatchObject({
      status: 'integration_unavailable', detail: expect.stringContaining('im:history'),
    });
  });

  it('reports a conversation the token cannot see as inaccessible', async () => {
    const { router } = setup({ messages: new SlackApiError('channel_not_found') });

    expect((await router.synthesizeThread(link())).status).toBe('inaccessible');
  });

  it('reports an empty conversation without paying for a summary', async () => {
    const { router, synthesizer } = setup({ messages: [{ ts: '1', user: 'U1', text: 'joined', subtype: 'channel_join' }] });

    expect((await router.synthesizeThread(link())).status).toBe('empty');
    expect(synthesizer.synthesize).not.toHaveBeenCalled();
  });

  it('never lets the token reach the logs, whatever fails', async () => {
    const { router, logger } = setup({ summary: new Error('boom xoxp-secret') });

    await expect(router.synthesizeThread(link())).rejects.toThrow();
    expect(JSON.stringify([logger.warn.mock.calls, logger.error.mock.calls, logger.info.mock.calls])).not.toContain('xoxp-secret');
  });

  it('stops without an error when the user cancels mid-fetch', async () => {
    const ac = new AbortController();
    const { router, logger } = setup({ messages: new Error('aborted') });
    ac.abort();

    expect(await router.synthesizeThread(link(), { signal: ac.signal })).toMatchObject({ status: 'inaccessible', detail: 'Import cancelled' });
    expect(logger.error).not.toHaveBeenCalled();
  });
});

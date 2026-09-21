import { describe, it, expect, vi } from 'vitest';
import { ManageSlackConnectorUseCase } from '../../src/application/use-cases/manage-slack-connector.js';
import { SlackApiError, type SlackIdentity } from '../../src/infrastructure/adapters/slack-web-api.client.js';
import type { SlackConnection } from '../../src/application/ports/slack-connection.port.js';

const TOKEN = 'xoxp-1234567890-abcdefWXYZ';
const IDENTITY: SlackIdentity = {
  teamId: 'T1', teamName: 'Evaneos', teamDomain: 'evaneos', userId: 'U1', userName: 'nas',
  scopes: ['channels:history', 'groups:history', 'users:read'],
};

function setup(authTest: () => Promise<SlackIdentity> = async () => IDENTITY) {
  let saved: SlackConnection | null = null;
  const store = {
    get: vi.fn(async () => saved),
    save: vi.fn(async (c: SlackConnection) => { saved = c; }),
    clear: vi.fn(async () => { saved = null; }),
  };
  const logger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const useCase = new ManageSlackConnectorUseCase(store, { authTest: vi.fn(authTest) }, logger);
  return { useCase, store, logger };
}

describe('ManageSlackConnectorUseCase', () => {
  it('checks the token with Slack, saves it, and reports who it is — without ever returning it', async () => {
    const { useCase, store } = setup();

    const status = await useCase.connect(`  ${TOKEN}  `);

    expect(store.save).toHaveBeenCalledWith(expect.objectContaining({ token: TOKEN, teamDomain: 'evaneos' }));
    expect(status).toMatchObject({ connected: true, teamName: 'Evaneos', userName: 'nas', tokenHint: 'xoxp-…WXYZ' });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    expect(JSON.stringify(await useCase.status())).not.toContain(TOKEN);
  });

  it('warns which conversations the token cannot read (here: DMs and group DMs)', async () => {
    const { useCase } = setup();

    expect(await useCase.connect(TOKEN)).toMatchObject({ missingScopes: ['im:history', 'mpim:history'] });
  });

  it('does not cry wolf when Slack does not say which scopes the token has', async () => {
    const { useCase } = setup(async () => ({ ...IDENTITY, scopes: [] }));

    expect(await useCase.connect(TOKEN)).toMatchObject({ missingScopes: [] });
  });

  it('refuses a token Slack rejects, and stores nothing', async () => {
    const { useCase, store } = setup(async () => { throw new SlackApiError('invalid_auth'); });

    await expect(useCase.connect(TOKEN)).rejects.toMatchObject({ code: 'CONNECTOR_INVALID_TOKEN' });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('explains a bot token instead of failing mysteriously on the first DM', async () => {
    const { useCase } = setup();

    await expect(useCase.connect('xoxb-1234567890-abcdef')).rejects.toThrow(/bot token.*user token/s);
  });

  it('does not blame the token when Slack is simply unreachable', async () => {
    const { useCase, store } = setup(async () => { throw new TypeError('fetch failed'); });

    await expect(useCase.connect(TOKEN)).rejects.toMatchObject({ code: 'CONNECTOR_UPSTREAM_FAILED' });
    expect(store.save).not.toHaveBeenCalled();
  });

  it('never writes the token to the logs', async () => {
    const { useCase, logger } = setup();
    await useCase.connect(TOKEN);

    expect(JSON.stringify([logger.info.mock.calls, logger.warn.mock.calls])).not.toContain(TOKEN);
  });

  it('disconnects', async () => {
    const { useCase } = setup();
    await useCase.connect(TOKEN);

    expect(await useCase.disconnect()).toEqual({ connected: false });
    expect(await useCase.status()).toEqual({ connected: false });
  });
});

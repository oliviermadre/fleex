import type { SlackConnectorStatus } from '@fleex/shared';
import type { SlackConnection, SlackConnectionStore } from '../ports/slack-connection.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { ConnectorError } from '../../domain/errors.js';
import { SlackApiError, type SlackIdentity } from '../../infrastructure/adapters/slack-web-api.client.js';

/** Without these the token cannot read the matching kind of conversation. */
const HISTORY_SCOPES = ['channels:history', 'groups:history', 'im:history', 'mpim:history'];

/**
 * Connect, inspect and disconnect the Slack connector. The token is checked
 * against Slack before it is stored — a typo is refused at the door, not
 * discovered at the first import — and is never handed back out.
 */
export class ManageSlackConnectorUseCase {
  constructor(
    private readonly connections: SlackConnectionStore,
    private readonly api: { authTest(token: string): Promise<SlackIdentity> },
    private readonly logger: LoggerPort,
  ) {}

  async status(): Promise<SlackConnectorStatus> {
    return toStatus(await this.connections.get());
  }

  async connect(rawToken: unknown): Promise<SlackConnectorStatus> {
    const token = typeof rawToken === 'string' ? rawToken.trim() : '';
    if (token.startsWith('xoxb-')) {
      throw new ConnectorError(
        'That is a bot token (xoxb-). Fleex needs a user token (xoxp-), so it can read the conversations you can read.',
        'CONNECTOR_INVALID_TOKEN',
      );
    }
    if (!/^xoxp-[A-Za-z0-9-]{10,}$/.test(token)) {
      throw new ConnectorError('That does not look like a Slack user token. It starts with "xoxp-".', 'CONNECTOR_INVALID_TOKEN');
    }

    let identity: SlackIdentity;
    try {
      identity = await this.api.authTest(token);
    } catch (err) {
      const code = err instanceof SlackApiError ? err.code : 'network';
      this.logger.warn('Slack token check failed', { code });
      if (err instanceof SlackApiError && !/^http_|^ratelimited$/.test(err.code)) {
        throw new ConnectorError(`Slack rejected this token (${err.code}).`, 'CONNECTOR_INVALID_TOKEN');
      }
      throw new ConnectorError('Slack could not be reached to check the token. Try again in a moment.', 'CONNECTOR_UPSTREAM_FAILED');
    }

    const connection: SlackConnection = { token, ...identity, connectedAt: new Date().toISOString() };
    await this.connections.save(connection);
    this.logger.info('Slack connector saved', { team: identity.teamDomain, user: identity.userName });
    return toStatus(connection);
  }

  async disconnect(): Promise<SlackConnectorStatus> {
    await this.connections.clear();
    this.logger.info('Slack connector removed');
    return { connected: false };
  }
}

function toStatus(connection: SlackConnection | null): SlackConnectorStatus {
  if (!connection) return { connected: false };
  return {
    connected: true,
    teamName: connection.teamName,
    teamDomain: connection.teamDomain,
    userName: connection.userName,
    tokenHint: `xoxp-…${connection.token.slice(-4)}`,
    // Slack only reports scopes for some token kinds: no header means "unknown", not "none".
    missingScopes: connection.scopes.length > 0 ? HISTORY_SCOPES.filter((s) => !connection.scopes.includes(s)) : [],
    connectedAt: connection.connectedAt,
  };
}

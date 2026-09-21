import { describe, it, expect } from 'vitest';
import type { SlackConnectorStatus } from '@fleex/shared';
import { slackReadsDirectly } from './connectorStore';

const connected: SlackConnectorStatus = {
  connected: true, teamName: 'Evaneos', teamDomain: 'evaneos', userName: 'nas',
  tokenHint: 'xoxp-…WXYZ', missingScopes: [], connectedAt: '2026-09-21T10:00:00.000Z',
};

describe('slackReadsDirectly', () => {
  // The UI promises "a few seconds" only when the server will really take the
  // API path — same rule as SlackImportRouter, or the promise is a lie.
  it('is true only for a link from the connected workspace', () => {
    expect(slackReadsDirectly(connected, 'evaneos')).toBe(true);
    expect(slackReadsDirectly(connected, 'Evaneos')).toBe(true);
    expect(slackReadsDirectly(connected, 'other-co')).toBe(false);
  });

  it('is false when nothing is connected, or not known yet', () => {
    expect(slackReadsDirectly({ connected: false }, 'evaneos')).toBe(false);
    expect(slackReadsDirectly(null, 'evaneos')).toBe(false);
    expect(slackReadsDirectly(connected, undefined)).toBe(false);
  });
});

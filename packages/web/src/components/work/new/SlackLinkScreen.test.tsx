import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SlackConnectorStatus } from '@fleex/shared';
import { SlackLinkScreen as Screen } from './SlackLinkScreen';
import { useConnectorStore } from '../../../stores/connectorStore';

/** The screen links to Settings → Connectors, so it needs a router around it. */
const SlackLinkScreen = (props: Parameters<typeof Screen>[0]) => (
  <MemoryRouter>
    <Screen {...props} />
  </MemoryRouter>
);

const connectedTo = (teamDomain: string): SlackConnectorStatus => ({
  connected: true, teamName: 'Evaneos', teamDomain, userName: 'nas',
  tokenHint: 'xoxp-…WXYZ', missingScopes: [], connectedAt: '2026-09-21T10:00:00.000Z',
});

beforeEach(() => useConnectorStore.setState({ slack: { connected: false } }));
afterEach(cleanup);

const LINK = 'https://acme.slack.com/archives/C0123ABCD/p1700000000123456';
const field = () => screen.getByLabelText('Slack message link');

describe('SlackLinkScreen', () => {
  it('imports a Slack permalink on Enter, with the ref existing tickets are found by', () => {
    const onImport = vi.fn();
    render(<SlackLinkScreen onBack={() => {}} onImport={onImport} />);

    fireEvent.change(field(), { target: { value: LINK } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onImport).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'slack_message', ref: 'C0123ABCD/1700000000.123456' }),
    );
  });

  it('refuses anything that is not a Slack message link, and says how to get one', () => {
    const onImport = vi.fn();
    render(<SlackLinkScreen onBack={() => {}} onImport={onImport} />);

    fireEvent.change(field(), { target: { value: 'https://github.com/acme/web/issues/1' } });
    fireEvent.keyDown(field(), { key: 'Enter' });

    expect(onImport).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: /Import/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/doesn't look like a Slack message link/)).toBeTruthy();
  });

  it('goes back on Esc', () => {
    const onBack = vi.fn();
    render(<SlackLinkScreen onBack={onBack} onImport={() => {}} />);

    fireEvent.keyDown(field(), { key: 'Escape' });

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('SlackLinkScreen — the wait it promises', () => {
  // The promise must follow the server's routing rule, or it is a lie.
  it('promises the slow path and points to Connectors when no token is saved', () => {
    render(<SlackLinkScreen onBack={() => {}} onImport={() => {}} />);

    expect(screen.getByText(/usually 10–40 s/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Settings → Connectors' })).toBeTruthy();
  });

  it('promises a few seconds for a link from the connected workspace', () => {
    useConnectorStore.setState({ slack: connectedTo('acme') });
    render(<SlackLinkScreen onBack={() => {}} onImport={() => {}} />);

    fireEvent.change(field(), { target: { value: LINK } }); // LINK is on acme.slack.com

    expect(screen.getByText(/a few seconds/)).toBeTruthy();
    expect(screen.queryByText(/10–40 s/)).toBeNull();
  });

  it('takes the promise back for a link from ANOTHER workspace, and says why', () => {
    useConnectorStore.setState({ slack: connectedTo('evaneos') });
    render(<SlackLinkScreen onBack={() => {}} onImport={() => {}} />);
    expect(screen.getByText(/a few seconds/)).toBeTruthy(); // before any link: a token is saved

    fireEvent.change(field(), { target: { value: LINK } }); // acme ≠ evaneos

    expect(screen.getByText(/usually 10–40 s/)).toBeTruthy();
    expect(screen.getByText(/another workspace than your Slack token/)).toBeTruthy();
  });
});


import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { SlackConnectorStatus } from '@fleex/shared';
import { ConnectorsTab } from './ConnectorsTab';
import { useConnectorStore } from '../../stores/connectorStore';

const api = vi.hoisted(() => ({
  fetch: vi.fn<() => Promise<SlackConnectorStatus>>(),
  connect: vi.fn<(token: string) => Promise<SlackConnectorStatus>>(),
  disconnect: vi.fn<() => Promise<SlackConnectorStatus>>(),
}));
vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchSlackConnector: api.fetch,
  connectSlackConnector: api.connect,
  disconnectSlackConnector: api.disconnect,
}));

const TOKEN = 'xoxp-1234567890-abcdefWXYZ';
const CONNECTED: SlackConnectorStatus = {
  connected: true, teamName: 'Evaneos', teamDomain: 'evaneos', userName: 'nas',
  tokenHint: 'xoxp-…WXYZ', missingScopes: [], connectedAt: '2026-09-21T10:00:00.000Z',
};
const field = () => screen.getByLabelText(/user token/i) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  useConnectorStore.setState({ slack: null });
  api.fetch.mockResolvedValue({ connected: false });
});
afterEach(cleanup);

describe('ConnectorsTab', () => {
  it('saves a token, shows who it belongs to, and does not keep the secret on screen', async () => {
    api.connect.mockResolvedValue(CONNECTED);
    render(<ConnectorsTab />);
    await screen.findByText(/Not connected/);

    fireEvent.change(field(), { target: { value: `  ${TOKEN} ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect(await screen.findByText(/Connected to/)).toBeTruthy();
    expect(api.connect).toHaveBeenCalledWith(TOKEN);
    expect(screen.getByText(/evaneos\.slack\.com · xoxp-…WXYZ/)).toBeTruthy();
    expect(field().value).toBe(''); // the secret is gone from the DOM
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  it('masks the token while it is typed', async () => {
    render(<ConnectorsTab />);
    await screen.findByText(/Not connected/);

    expect(field().type).toBe('password');
    expect(field().autocomplete).toBe('off');
  });

  it("shows Slack's refusal next to the field, keeps the token so it can be fixed, and stays disconnected", async () => {
    api.connect.mockRejectedValue(new Error('Slack rejected this token (invalid_auth).'));
    render(<ConnectorsTab />);
    await screen.findByText(/Not connected/);

    fireEvent.change(field(), { target: { value: TOKEN } });
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

    expect((await screen.findByRole('alert')).textContent).toContain('invalid_auth');
    expect(field().getAttribute('aria-invalid')).toBe('true');
    expect(field().value).toBe(TOKEN);
    expect(screen.queryByText(/Connected to/)).toBeNull();
  });

  it('says in plain words which conversations a token cannot read', async () => {
    api.fetch.mockResolvedValue({ ...CONNECTED, missingScopes: ['im:history', 'mpim:history'] });
    render(<ConnectorsTab />);

    expect(await screen.findByText(/can't read direct messages, group direct messages/)).toBeTruthy();
  });

  it('asks the server for the truth every time it opens, not a remembered answer', async () => {
    // Another tab, or the file on disk, may have changed the connection since.
    useConnectorStore.setState({ slack: { connected: false } });
    api.fetch.mockResolvedValue(CONNECTED);
    render(<ConnectorsTab />);

    expect(await screen.findByText(/Connected to/)).toBeTruthy();
    expect(api.fetch).toHaveBeenCalledTimes(1);
  });

  it('disconnects', async () => {
    api.fetch.mockResolvedValue(CONNECTED);
    api.disconnect.mockResolvedValue({ connected: false });
    render(<ConnectorsTab />);

    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));

    await waitFor(() => expect(screen.getByText(/Not connected/)).toBeTruthy());
    expect(api.disconnect).toHaveBeenCalledTimes(1);
  });
});

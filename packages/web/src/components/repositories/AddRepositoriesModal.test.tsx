import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as api from '../../services/api';
import { useSettingsStore } from '../../stores/settingsStore';

import { AddRepositoriesModal } from './AddRepositoriesModal';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchGithubDiscovery: vi.fn(),
  verifyGithubRepo: vi.fn(),
}));

const discovery = {
  owners: [
    {
      login: 'acme',
      repos: [
        { nameWithOwner: 'acme/app', visibility: 'private', updatedAt: '2026-07-18T00:00:00Z' },
        { nameWithOwner: 'acme/lib', visibility: 'public', updatedAt: '2026-07-01T00:00:00Z' },
      ],
    },
  ],
  totalRepos: 2,
};

describe('AddRepositoriesModal', () => {
  beforeEach(() => {
    vi.mocked(api.fetchGithubDiscovery).mockResolvedValue(discovery);
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, repositories: ['acme/app'] } }));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('marks tracked repos and lets you select the rest', async () => {
    render(<AddRepositoriesModal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('acme/lib')).toBeTruthy());
    expect(screen.getByText('already tracked')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /acme\/lib/i }));
    expect(screen.getByText('Add 1 repo')).toBeTruthy();
  });

  it('submits the selection through addRepositories', async () => {
    const addRepositories = vi.fn(async () => {});
    useSettingsStore.setState({ addRepositories } as never);
    const onClose = vi.fn();
    render(<AddRepositoriesModal open onClose={onClose} />);
    await waitFor(() => screen.getByText('acme/lib'));
    fireEvent.click(screen.getByRole('switch', { name: /acme\/lib/i }));
    fireEvent.click(screen.getByText('Add 1 repo'));
    await waitFor(() => expect(addRepositories).toHaveBeenCalledWith(['acme/lib']));
    expect(onClose).toHaveBeenCalled();
  });

  it('gates the free-form flow on format then existence', async () => {
    vi.mocked(api.verifyGithubRepo).mockResolvedValue({ exists: false });
    render(<AddRepositoriesModal open onClose={() => {}} />);
    await waitFor(() => screen.getByText('acme/lib'));
    const input = screen.getByPlaceholderText(/owner\/repo/i);
    const verify = screen.getByText('Verify & add') as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'anthropics/claude-code' } });
    expect(verify.disabled).toBe(false);
    fireEvent.click(verify);
    await waitFor(() => expect(screen.getByText('Repository not found')).toBeTruthy());
  });

  it('shows the error state when discovery fails', async () => {
    vi.mocked(api.fetchGithubDiscovery).mockRejectedValue(new Error('502'));
    render(<AddRepositoriesModal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/not authenticated or unavailable/i)).toBeTruthy());
  });
});

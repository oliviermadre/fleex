import { describe, it, expect, vi, beforeEach } from 'vitest';

import { useRepositoryStore } from './repositoryStore';
import { useSettingsStore } from './settingsStore';
import { useToastStore } from './toastStore';

describe('settingsStore repository list helpers', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    useSettingsStore.setState((s) => ({
      settings: { ...s.settings, repositories: ['acme/app'], resolvedRepositories: ['acme/app'] },
    }));
    useRepositoryStore.setState({ fetchRepositories: vi.fn(async () => {}) });
    useToastStore.setState({ toasts: [] });
  });

  it('addRepositories lowercases, dedupes and sorts', async () => {
    await useSettingsStore.getState().addRepositories(['Acme/Lib', 'acme/app', 'zeta/tool']);
    expect(useSettingsStore.getState().settings.repositories).toEqual([
      'acme/app',
      'acme/lib',
      'zeta/tool',
    ]);
  });

  it('removeRepository removes case-insensitively', async () => {
    await useSettingsStore.getState().removeRepository('ACME/APP');
    expect(useSettingsStore.getState().settings.repositories).toEqual([]);
  });

  it('addRepositories rejects and leaves repositories unchanged when the server call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => 'boom',
        statusText: 'err',
      })),
    );
    await expect(useSettingsStore.getState().addRepositories(['zeta/tool'])).rejects.toThrow();
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app']);
  });

  it('removeRepository rejects and leaves repositories unchanged when the server call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => 'boom',
        statusText: 'err',
      })),
    );
    await expect(useSettingsStore.getState().removeRepository('acme/app')).rejects.toThrow();
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app']);
  });

  it('addRepositories adopts the resolved list the server computed', async () => {
    // Only the server can expand glob patterns like `acme/*`, so its response
    // wins over the optimistic local merge — otherwise every consumer of
    // resolvedRepositories (ticket repo picker, filters, scratchpads) stays stale.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          repositories: ['acme/*'],
          resolvedRepositories: ['acme/app', 'acme/lib'],
        }),
      })),
    );
    await useSettingsStore.getState().addRepositories(['acme/*']);
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/*']);
    expect(useSettingsStore.getState().settings.resolvedRepositories).toEqual([
      'acme/app',
      'acme/lib',
    ]);
  });

  it('addRepositories falls back to the local list when the server omits the fields', async () => {
    await useSettingsStore.getState().addRepositories(['zeta/tool']);
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app', 'zeta/tool']);
    expect(useSettingsStore.getState().settings.resolvedRepositories).toEqual(['acme/app']);
  });

  it('removeRepository adopts the resolved list the server computed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ repositories: [], resolvedRepositories: [] }),
      })),
    );
    await useSettingsStore.getState().removeRepository('acme/app');
    expect(useSettingsStore.getState().settings.resolvedRepositories).toEqual([]);
  });

  it('addRepositories refreshes the repository store so the New Task picker updates', async () => {
    await useSettingsStore.getState().addRepositories(['zeta/tool']);
    expect(useRepositoryStore.getState().fetchRepositories).toHaveBeenCalledTimes(1);
  });

  it('removeRepository refreshes the repository store so the New Task picker updates', async () => {
    await useSettingsStore.getState().removeRepository('acme/app');
    expect(useRepositoryStore.getState().fetchRepositories).toHaveBeenCalledTimes(1);
  });

  it('addRepositories resolves even when the repository refresh fails', async () => {
    useRepositoryStore.setState({
      fetchRepositories: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    await expect(
      useSettingsStore.getState().addRepositories(['zeta/tool']),
    ).resolves.toBeUndefined();
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app', 'zeta/tool']);
  });

  it('does not refresh the repository store when the config update fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 500,
        text: async () => 'boom',
        statusText: 'err',
      })),
    );
    await expect(useSettingsStore.getState().addRepositories(['zeta/tool'])).rejects.toThrow();
    expect(useRepositoryStore.getState().fetchRepositories).not.toHaveBeenCalled();
  });
});

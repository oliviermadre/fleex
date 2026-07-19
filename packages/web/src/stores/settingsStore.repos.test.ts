import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';
import { useToastStore } from './toastStore';

describe('settingsStore repository list helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, repositories: ['acme/app'] } }));
    useToastStore.setState({ toasts: [] });
  });

  it('addRepositories lowercases, dedupes and sorts', async () => {
    await useSettingsStore.getState().addRepositories(['Acme/Lib', 'acme/app', 'zeta/tool']);
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app', 'acme/lib', 'zeta/tool']);
  });

  it('removeRepository removes case-insensitively', async () => {
    await useSettingsStore.getState().removeRepository('ACME/APP');
    expect(useSettingsStore.getState().settings.repositories).toEqual([]);
  });

  it('addRepositories rejects and leaves repositories unchanged when the server call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'boom',
      statusText: 'err',
    })));
    await expect(useSettingsStore.getState().addRepositories(['zeta/tool'])).rejects.toThrow();
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app']);
  });

  it('removeRepository rejects and leaves repositories unchanged when the server call fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 500,
      text: async () => 'boom',
      statusText: 'err',
    })));
    await expect(useSettingsStore.getState().removeRepository('acme/app')).rejects.toThrow();
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app']);
  });
});

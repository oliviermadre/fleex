import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('settingsStore repository list helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, repositories: ['acme/app'] } }));
  });

  it('addRepositories lowercases, dedupes and sorts', async () => {
    await useSettingsStore.getState().addRepositories(['Acme/Lib', 'acme/app', 'zeta/tool']);
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app', 'acme/lib', 'zeta/tool']);
  });

  it('removeRepository removes case-insensitively', async () => {
    await useSettingsStore.getState().removeRepository('ACME/APP');
    expect(useSettingsStore.getState().settings.repositories).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { GLOBAL_KEY, scratchTabs, resolveActiveScratchTab } from './scratchTabs';

describe('scratchTabs', () => {
  it('always leads with a Global tab', () => {
    expect(scratchTabs([])).toEqual([{ key: GLOBAL_KEY, label: 'Global' }]);
  });

  it('adds one tab per repo, labelled by the repo short name', () => {
    expect(scratchTabs(['acme/web', 'acme/api'])).toEqual([
      { key: GLOBAL_KEY, label: 'Global' },
      { key: 'acme/web', label: 'web' },
      { key: 'acme/api', label: 'api' },
    ]);
  });

  it('preserves repo order and dedupes repeats', () => {
    expect(scratchTabs(['acme/web', 'acme/web', 'acme/api'])).toEqual([
      { key: GLOBAL_KEY, label: 'Global' },
      { key: 'acme/web', label: 'web' },
      { key: 'acme/api', label: 'api' },
    ]);
  });

  it('never emits a second Global tab even if a repo key collides', () => {
    expect(scratchTabs([GLOBAL_KEY])).toEqual([{ key: GLOBAL_KEY, label: 'Global' }]);
  });

  it('falls back to the whole key when it has no slash', () => {
    expect(scratchTabs(['scratch'])).toEqual([
      { key: GLOBAL_KEY, label: 'Global' },
      { key: 'scratch', label: 'scratch' },
    ]);
  });
});

describe('resolveActiveScratchTab', () => {
  const tabs = scratchTabs(['acme/web', 'acme/api']);

  it('keeps the persisted tab when it still exists', () => {
    expect(resolveActiveScratchTab(tabs, 'acme/api')).toBe('acme/api');
  });

  it('falls back to Global when the persisted tab is gone', () => {
    expect(resolveActiveScratchTab(tabs, 'acme/removed')).toBe(GLOBAL_KEY);
  });

  it('falls back to Global when nothing is persisted', () => {
    expect(resolveActiveScratchTab(tabs, undefined)).toBe(GLOBAL_KEY);
  });
});

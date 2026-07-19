import { describe, it, expect, vi } from 'vitest';
import { migrateRepositoryPatterns } from '../../src/domain/services/repository-pattern-migration.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';

function fakeConfig(initial: Partial<AppConfig>): ConfigPort & { updates: Partial<AppConfig>[] } {
  let data: AppConfig = { basePath: '/tmp', defaultShell: '/bin/zsh', repositoryRefreshIntervalMs: 0, ...initial };
  const updates: Partial<AppConfig>[] = [];
  return {
    updates,
    init: async () => {},
    get: () => ({ ...data }),
    update: async (partial) => { updates.push(partial); data = { ...data, ...partial }; },
    getClaudeCommand: () => 'claude',
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

describe('migrateRepositoryPatterns', () => {
  it('is a no-op when no pattern contains a wildcard', async () => {
    const config = fakeConfig({ repositories: ['acme/app', 'acme/lib'] });
    await migrateRepositoryPatterns(config, { resolve: vi.fn() }, logger);
    expect(config.updates).toHaveLength(0);
  });

  it('expands wildcard patterns into an explicit deduped list', async () => {
    const config = fakeConfig({ repositories: ['acme/*', 'other/tool'] });
    const resolver = { resolve: vi.fn(async () => ['acme/app', 'acme/lib', 'other/tool']) };
    await migrateRepositoryPatterns(config, resolver, logger);
    expect(resolver.resolve).toHaveBeenCalledWith(['acme/*']);
    const final = config.get();
    expect(final.repositories).toEqual(['acme/app', 'acme/lib', 'other/tool']);
    expect(final.resolvedRepositories).toEqual(['acme/app', 'acme/lib', 'other/tool']);
    expect(final.resolvedAt).toBeTruthy();
  });

  it('keeps a pattern intact when resolution returns nothing (gh down)', async () => {
    const config = fakeConfig({ repositories: ['acme/*', 'other/tool'] });
    const resolver = { resolve: vi.fn(async () => []) };
    await migrateRepositoryPatterns(config, resolver, logger);
    const final = config.get();
    expect(final.repositories).toEqual(['acme/*', 'other/tool']);
    expect(final.resolvedRepositories).toEqual(['other/tool']);
  });

  it('is idempotent: second run after full expansion does nothing', async () => {
    const config = fakeConfig({ repositories: ['acme/*'] });
    const resolver = { resolve: vi.fn(async () => ['acme/app']) };
    await migrateRepositoryPatterns(config, resolver, logger);
    const countAfterFirst = config.updates.length;
    await migrateRepositoryPatterns(config, resolver, logger);
    expect(config.updates.length).toBe(countAfterFirst);
  });
});

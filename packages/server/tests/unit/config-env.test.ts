import { describe, it, expect, afterEach } from 'vitest';

import {
  applyBasePathEnvOverride,
  BASE_PATH_ENV,
} from '../../src/infrastructure/adapters/config-env.js';

import type { AppConfig } from '../../src/application/ports/config.port.js';

function cfg(basePath: string): AppConfig {
  return { basePath, defaultShell: '/bin/zsh', repositoryRefreshIntervalMs: 0 };
}

const original = process.env[BASE_PATH_ENV];
afterEach(() => {
  if (original === undefined) delete process.env[BASE_PATH_ENV];
  else process.env[BASE_PATH_ENV] = original;
});

describe('applyBasePathEnvOverride', () => {
  it('overrides basePath when the env var is set', () => {
    process.env[BASE_PATH_ENV] = '~/projects-tada';
    const config = cfg('~/projects');
    applyBasePathEnvOverride(config);
    expect(config.basePath).toBe('~/projects-tada');
  });

  it('is a no-op when the env var is unset (DB value preserved)', () => {
    delete process.env[BASE_PATH_ENV];
    const config = cfg('/home/user/projects');
    applyBasePathEnvOverride(config);
    expect(config.basePath).toBe('/home/user/projects');
  });

  it('is a no-op for a blank env var', () => {
    process.env[BASE_PATH_ENV] = '   ';
    const config = cfg('/home/user/projects');
    applyBasePathEnvOverride(config);
    expect(config.basePath).toBe('/home/user/projects');
  });
});

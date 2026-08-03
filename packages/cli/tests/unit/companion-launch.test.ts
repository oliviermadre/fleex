import { describe, it, expect } from 'vitest';

import { buildCompanionLaunch, type CompanionLaunchContext } from '../../src/core/companion.ts';

const ctx: CompanionLaunchContext = {
  repoDir: '/home/me/.fleex/repo',
  execPath: '/usr/local/bin/bun',
  baseEnv: {},
  configEnv: {},
};

describe('buildCompanionLaunch', () => {
  it('launches the sidepanel-host server from the resolved repo with the current runtime', () => {
    const launch = buildCompanionLaunch(ctx);
    expect(launch.bin).toBe('/usr/local/bin/bun');
    expect(launch.args).toEqual(['/home/me/.fleex/repo/packages/sidepanel-host/src/server.ts']);
    expect(launch.cwd).toBe('/home/me/.fleex/repo');
  });

  it('pins tool execution to THIS repo CLI so surface and execution never drift', () => {
    // The companion generates tools from one CLI tree but executes through
    // another via FLEEX_MCP_BIN/PREFIX — they must point at the same repo.
    const { env } = buildCompanionLaunch(ctx);
    expect(env.FLEEX_MCP_BIN).toBe('/usr/local/bin/bun');
    expect(env.FLEEX_MCP_PREFIX).toBe('run /home/me/.fleex/repo/packages/cli/index.ts');
  });

  it('sources ANTHROPIC_API_KEY from the config file (so it never has to be typed inline)', () => {
    const { env } = buildCompanionLaunch({
      ...ctx,
      configEnv: { ANTHROPIC_API_KEY: 'sk-ant-from-config' },
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-config');
  });

  it('lets the live shell env win over the config file (override for one-off runs)', () => {
    const { env } = buildCompanionLaunch({
      ...ctx,
      configEnv: { ANTHROPIC_API_KEY: 'sk-ant-from-config' },
      baseEnv: { ANTHROPIC_API_KEY: 'sk-ant-from-shell' } as NodeJS.ProcessEnv,
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-shell');
  });

  it('keeps the config key when the shell exports an empty ANTHROPIC_API_KEY', () => {
    // A bare `export ANTHROPIC_API_KEY=` (or an unset-but-present var) shows up
    // as '' in process.env. That must NOT clobber the real key from the config
    // file — otherwise the companion boots "healthy" but can't authenticate.
    const { env } = buildCompanionLaunch({
      ...ctx,
      configEnv: { ANTHROPIC_API_KEY: 'sk-ant-from-config' },
      baseEnv: { ANTHROPIC_API_KEY: '' } as NodeJS.ProcessEnv,
    });
    expect(env.ANTHROPIC_API_KEY).toBe('sk-ant-from-config');
  });

  it('honours an explicit FLEEX_MCP_BIN/PREFIX override (power user / dev)', () => {
    const base = { FLEEX_MCP_BIN: 'fleex', FLEEX_MCP_PREFIX: '' } as NodeJS.ProcessEnv;
    const { env } = buildCompanionLaunch({ ...ctx, baseEnv: base });
    expect(env.FLEEX_MCP_BIN).toBe('fleex');
    // Empty string is a deliberate override (fleex on PATH, no prefix args).
    expect(env.FLEEX_MCP_PREFIX).toBe('');
  });
});

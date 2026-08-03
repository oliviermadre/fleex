import { describe, it, expect } from 'vitest';

import { buildMcpLaunch, type McpLaunchContext } from '../../src/commands/mcp/start/_impl.ts';

const ctx: McpLaunchContext = {
  execPath: '/usr/local/bin/bun',
  serverPath: '/repo/packages/mcp/src/server.ts',
  cliEntry: '/repo/packages/cli/index.ts',
  baseEnv: {},
};

describe('buildMcpLaunch', () => {
  it('spawns the stdio server with the current runtime', () => {
    const launch = buildMcpLaunch({}, ctx);
    expect(launch.bin).toBe('/usr/local/bin/bun');
    expect(launch.args).toEqual(['/repo/packages/mcp/src/server.ts']);
  });

  it('re-invokes THIS CLI for tool execution so surface and execution never drift', () => {
    // The whole point of the wrapper: a tool call must run the same fleex code
    // the user launched, not whatever happens to be on PATH.
    const { envOverrides } = buildMcpLaunch({}, ctx);
    expect(envOverrides.FLEEX_MCP_BIN).toBe('/usr/local/bin/bun');
    expect(envOverrides.FLEEX_MCP_PREFIX).toBe('/repo/packages/cli/index.ts');
  });

  it('forwards --workspace as FLEEX_WORKSPACE (this is how the server scopes every tool)', () => {
    const { envOverrides } = buildMcpLaunch({ workspace: 'evaneos' }, ctx);
    expect(envOverrides.FLEEX_WORKSPACE).toBe('evaneos');
  });

  it('omits FLEEX_WORKSPACE entirely when no workspace is given (CLI then uses the default)', () => {
    const { envOverrides } = buildMcpLaunch({}, ctx);
    expect('FLEEX_WORKSPACE' in envOverrides).toBe(false);
  });

  it('forwards --include as FLEEX_MCP_INCLUDE', () => {
    const { envOverrides } = buildMcpLaunch({ include: 'ticket,epic,board' }, ctx);
    expect(envOverrides.FLEEX_MCP_INCLUDE).toBe('ticket,epic,board');
  });

  it('lets an explicit env var win over the wrapper defaults (power-user override)', () => {
    const base = {
      FLEEX_MCP_BIN: 'fleex',
      FLEEX_MCP_PREFIX: '',
      FLEEX_WORKSPACE: 'from-env',
      FLEEX_MCP_INCLUDE: 'ticket',
    } as NodeJS.ProcessEnv;
    const { envOverrides } = buildMcpLaunch({}, { ...ctx, baseEnv: base });
    expect(envOverrides.FLEEX_MCP_BIN).toBe('fleex');
    // Empty-string prefix is a deliberate override (fleex on PATH, no prefix args).
    expect(envOverrides.FLEEX_MCP_PREFIX).toBe('');
    expect(envOverrides.FLEEX_WORKSPACE).toBe('from-env');
    expect(envOverrides.FLEEX_MCP_INCLUDE).toBe('ticket');
  });

  it('keeps the confirmation bypass off unless explicitly asked for', () => {
    // The server refuses prompt-blocking tools by default; enabling the bypass
    // hands approval authority to the MCP client, so it must be a conscious act.
    expect('FLEEX_MCP_ASSUME_YES' in buildMcpLaunch({}, ctx).envOverrides).toBe(false);
    expect(buildMcpLaunch({ assumeYes: true }, ctx).envOverrides.FLEEX_MCP_ASSUME_YES).toBe('1');
  });

  it('never rewrites the bypass value the server is responsible for parsing', () => {
    // Regression: the launcher used to re-emit any non-empty FLEEX_MCP_ASSUME_YES
    // as '1'. Since '0' is a truthy string, `FLEEX_MCP_ASSUME_YES=0` — the most
    // natural way to say "off" — silently turned the bypass ON. Two parsers for
    // one security flag, and the looser one won.
    //
    // The launcher now sets the variable only for --assume-yes; anything already
    // in the environment reaches the child untouched by inheritance, so the
    // strict predicate in server.ts is the only thing that decides.
    for (const raw of ['0', 'false', 'off', 'no', '1', 'true', 'yes']) {
      const base = { FLEEX_MCP_ASSUME_YES: raw } as NodeJS.ProcessEnv;
      const { envOverrides } = buildMcpLaunch({}, { ...ctx, baseEnv: base });
      expect('FLEEX_MCP_ASSUME_YES' in envOverrides, `env value ${raw}`).toBe(false);
    }
  });

  it('an explicit flag still wins over the env (flag > env > default)', () => {
    const base = { FLEEX_WORKSPACE: 'from-env' } as NodeJS.ProcessEnv;
    const { envOverrides } = buildMcpLaunch({ workspace: 'from-flag' }, { ...ctx, baseEnv: base });
    expect(envOverrides.FLEEX_WORKSPACE).toBe('from-flag');
  });
});

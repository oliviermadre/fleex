import { describe, it, expect, vi } from 'vitest';
import { ApiClaudeUsageAdapter } from './api-claude-usage.adapter.js';
import type { ExecFn, HostFs } from '../host/types.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
const noFile = { readFile: vi.fn(async () => { throw new Error('ENOENT'); }) } as unknown as HostFs;
const mcpOnly = JSON.stringify({ mcpOAuth: { notion: {} } });
const withToken = JSON.stringify({ mcpOAuth: {}, claudeAiOauth: { accessToken: 'tok' } });

describe('ApiClaudeUsageAdapter.hasCredentials', () => {
  it('finds the token in the user’s own keychain item even when another item (MCP tokens only) shadows it', async () => {
    // `security` without -a returns the first item: a stray "unknown" one, which
    // used to hide every AI helper in Settings › Actions.
    const execFn = vi.fn(async (_c: string, args: string[]) => {
      const acct = args[args.indexOf('-a') + 1];
      return { stdout: args.includes('-a') && acct === 'olivier' ? withToken : mcpOnly, stderr: '' };
    }) as unknown as ExecFn;
    const adapter = new ApiClaudeUsageAdapter(execFn, noFile, '/Users/olivier', logger);
    expect(await adapter.hasCredentials()).toBe(true);
  });

  it('still falls back to any keychain item when the account has none', async () => {
    const execFn = vi.fn(async (_c: string, args: string[]) => {
      if (args.includes('-a')) throw new Error('The specified item could not be found');
      return { stdout: withToken, stderr: '' };
    }) as unknown as ExecFn;
    expect(await new ApiClaudeUsageAdapter(execFn, noFile, '/Users/olivier', logger).hasCredentials()).toBe(true);
  });

  it('reports no credentials when no item holds a Claude token', async () => {
    const execFn = vi.fn(async () => ({ stdout: mcpOnly, stderr: '' })) as unknown as ExecFn;
    expect(await new ApiClaudeUsageAdapter(execFn, noFile, '/Users/olivier', logger).hasCredentials()).toBe(false);
  });
});

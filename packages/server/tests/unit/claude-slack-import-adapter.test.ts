import { describe, it, expect, vi } from 'vitest';

// Mock the Agent SDK seam so the test never touches the real Claude Agent SDK.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeSlackImportAdapter } from '../../src/infrastructure/adapters/claude-slack-import.adapter.js';
import { SdkConcurrencyLimiter } from '../../src/application/services/sdk-concurrency-limiter.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;
const logger = { info() {}, warn() {}, error() {}, debug() {} } as unknown as LoggerPort;

describe('ClaudeSlackImportAdapter — background tasks are disabled (claude-code#103157 workaround)', () => {
  // This one-shot has an outputFormat AND tools (Slack MCP, bypassPermissions):
  // a tool the CLI auto-backgrounds would make it hand back a partial synthesis.
  it('runs the SDK query with CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1', async () => {
    mockedQuery.mockImplementation(async function* () {
      yield { type: 'result', result: '', structured_output: { status: 'empty' } };
    });
    const adapter = new ClaudeSlackImportAdapter(new SdkConcurrencyLimiter(() => 1), logger);

    await adapter.synthesizeThread({ workspace: 'acme', channelId: 'C1', ts: '1700000000.000100' } as never);

    const options = mockedQuery.mock.calls[0]![0].options as { env?: Record<string, string> };
    expect(options.env?.CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe('1');
    expect(options.env?.PATH).toBe(process.env.PATH);
  });
});

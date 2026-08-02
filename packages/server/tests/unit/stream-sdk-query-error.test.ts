import { describe, it, expect, vi } from 'vitest';

// The real SDK spawns the Claude Code CLI subprocess, so the module has to be
// stubbed to drive the message loop. Everything under test — the capture of the
// structured error code — is the adapter's own code, not the mock's.
const messages: Record<string, unknown>[] = [];
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: () => (async function* () {
    for (const m of messages) yield m;
  })(),
}));

const { streamSdkQuery } = await import('../../src/application/utils/stream-sdk-query.js');

function run() {
  return streamSdkQuery({
    prompt: 'hi',
    queryOptions: {},
    emitEvent: () => {},
  });
}

describe('streamSdkQuery — structured error capture', () => {
  // WHY: `SDKAssistantMessage.error` is the most trustworthy crash signal the
  // SDK gives us (classify-crash ranks it above the regex layer). If the stream
  // loop drops it, that whole branch is dead code and a rate-limit crash silently
  // degrades to `unknown` — the generic card the ticket is trying to remove.
  it('surfaces the last assistant error code', async () => {
    messages.length = 0;
    messages.push(
      { type: 'assistant', message: { content: [] } },
      { type: 'assistant', error: 'rate_limit', message: { content: [] } },
      { type: 'result', result: '', subtype: 'error_during_execution' },
    );

    const res = await run();
    expect(res.lastAssistantError).toBe('rate_limit');
    expect(res.resultSubtype).toBe('error_during_execution');
  });

  // WHY: a run can emit a transient error then recover and fail later for a
  // different reason. The card must show why it *ended*, so the last code wins.
  it('keeps the last code when several assistant errors arrive', async () => {
    messages.length = 0;
    messages.push(
      { type: 'assistant', error: 'server_error', message: { content: [] } },
      { type: 'assistant', error: 'authentication_failed', message: { content: [] } },
      { type: 'result', result: '' },
    );

    expect((await run()).lastAssistantError).toBe('authentication_failed');
  });

  // WHY: the overwhelming majority of runs carry no error at all — the field
  // must stay undefined so classify-crash falls through instead of matching an
  // empty string.
  it('leaves the code undefined on a clean run', async () => {
    messages.length = 0;
    messages.push(
      { type: 'assistant', message: { content: [] } },
      { type: 'result', result: 'done' },
    );

    expect((await run()).lastAssistantError).toBeUndefined();
  });
});

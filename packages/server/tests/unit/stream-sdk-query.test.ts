import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the Agent SDK seam so the test never touches the real Claude Agent SDK.
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: vi.fn() }));

import { query } from '@anthropic-ai/claude-agent-sdk';
import { streamSdkQuery } from '../../src/application/utils/stream-sdk-query.js';

const mockedQuery = query as unknown as ReturnType<typeof vi.fn>;

/** A `result` message shaped like the SDK's terminal frame. */
const RESULT_MSG = {
  type: 'result',
  subtype: 'success',
  result: 'done',
  structured_output: { title: 'ok' },
  duration_ms: 1234,
  total_cost_usd: 0.5,
  num_turns: 7,
};

/**
 * Stream that yields `messages` then NEVER completes — the observed failure mode:
 * the CLI subprocess delivers its result and leaves the stream open forever.
 *
 * `onSilence` fires at the moment it runs dry, which is what lets a test act on
 * "the stream has gone quiet" without timing it.
 */
function neverEndingStream(messages: unknown[], onReturn?: () => void, onSilence?: () => void) {
  let i = 0;
  return {
    [Symbol.asyncIterator]() {
      return {
        next: async () => {
          if (i < messages.length) return { value: messages[i++], done: false };
          onSilence?.();
          return new Promise<IteratorResult<unknown>>(() => {}); // hangs forever
        },
        return: async () => {
          onReturn?.();
          return { value: undefined, done: true as const };
        },
      };
    },
  };
}

describe('streamSdkQuery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns on the terminal result even when the stream never closes', async () => {
    // WHY: a `for await` here would hang forever with the answer already in hand
    // — the run stayed "Running for 19m" after its structured output landed.
    const emitted: string[] = [];
    mockedQuery.mockReturnValue(neverEndingStream([{ type: 'assistant' }, RESULT_MSG]));

    const res = await streamSdkQuery({
      prompt: 'go',
      queryOptions: {},
      emitEvent: (t) => void emitted.push(t),
    });

    expect(res.resultText).toBe('done');
    expect(res.structuredOutput).toEqual({ title: 'ok' });
    expect(res.metrics.numTurns).toBe(7);
    expect(res.messageCount).toBe(2);
    expect(emitted).toEqual(['content_block_delta', 'message_stop']);
  });

  it('cancels the generator so the CLI subprocess is torn down', async () => {
    const onReturn = vi.fn();
    mockedQuery.mockReturnValue(neverEndingStream([RESULT_MSG], onReturn));

    await streamSdkQuery({ prompt: 'go', queryOptions: {}, emitEvent: () => {} });

    expect(onReturn).toHaveBeenCalledOnce();
  });

  it('aborts a stalled stream instead of waiting for the next message', async () => {
    // WHY: the old loop only re-read the abort signal when a message arrived, so
    // the execution timeout could never rescue a stream that had gone silent.
    const ac = new AbortController();
    // Aborted when the stream goes silent rather than after a wall-clock delay: a
    // timer races the generator's first yield, and on a loaded machine the timer
    // wins — failing the assertion below for a reason this test is not about.
    mockedQuery.mockReturnValue(
      neverEndingStream([{ type: 'assistant' }], undefined, () => ac.abort(new Error('timeout'))),
    );

    const res = await streamSdkQuery({
      prompt: 'go',
      queryOptions: {},
      emitEvent: () => {},
      abortSignal: ac.signal,
    });

    expect(res.resultText).toBe(''); // no result reached — the caller marks it interrupted
    expect(res.messageCount).toBe(1);
  });

  it('still returns normally when the stream does close on its own', async () => {
    mockedQuery.mockReturnValue(
      (async function* () {
        yield RESULT_MSG;
      })(),
    );

    const res = await streamSdkQuery({ prompt: 'go', queryOptions: {}, emitEvent: () => {} });

    expect(res.resultText).toBe('done');
  });

  it('propagates a stream error with the captured CLI stderr attached', async () => {
    mockedQuery.mockImplementation((args: { options: Record<string, unknown> }) => {
      const writeStderr = args.options['stderr'] as (c: string) => void;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              writeStderr('boom: bad stdin');
              throw new Error('Claude Code process exited with code 1');
            },
          };
        },
      };
    });

    await expect(
      streamSdkQuery({ prompt: 'go', queryOptions: {}, emitEvent: () => {} }),
    ).rejects.toThrow(/exited with code 1[\s\S]*boom: bad stdin/);
  });
});

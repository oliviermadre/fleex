import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Regression cover for ghost runs: an agent that finished its work (it emitted
 * `result`, the PR was pushed, StructuredOutput was sent) but whose execution
 * stayed flagged `running` forever — "The Builder is working." and the
 * Terminate button never went away.
 *
 * The root cause was in this loop: it kept iterating past the terminal `result`
 * message, waiting for the `claude` subprocess to close stdout. When the child
 * lingered (orphan MCP server, hook, unflushed pipe) the generator never
 * returned, `streamSdkQuery` never resolved, and none of the finalization
 * (execution_end, comment, deliverable, mention resolve) ever ran.
 *
 * These tests encode the *intent*: the stream must hand control back to the
 * caller as soon as the agent's answer is known — and, failing that, as soon as
 * the caller aborts — regardless of what the subprocess does.
 */

const queryMock = vi.fn();
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: (...args: unknown[]) => queryMock(...args) }));

const { streamSdkQuery } = await import('../../src/application/utils/stream-sdk-query.js');

/** Never-ending promise: stands in for a subprocess that stops talking. */
const forever = () => new Promise<never>(() => {});

// Braces matter: `mockReset()` returns the mock, and a function returned from
// `beforeEach` is treated by Vitest as a teardown hook — it would call the mock.
beforeEach(() => { queryMock.mockReset(); });

describe('streamSdkQuery — termination', () => {
  it('returns on the terminal `result` message even if the stream never ends', async () => {
    let onClosed!: () => void;
    const closed = new Promise<void>((r) => { onClosed = r; });
    queryMock.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: (() => {
          let sent = false;
          return async () => {
            if (sent) return forever(); // subprocess hangs after `result`
            sent = true;
            return { done: false, value: { type: 'result', result: 'done', structured_output: { ok: true } } };
          };
        })(),
        return: async () => { onClosed(); return { done: true, value: undefined }; },
      }),
    });

    const result = await streamSdkQuery({
      prompt: 'hi',
      queryOptions: {},
      emitEvent: () => {},
    });

    expect(result.exitReason).toBe('result');
    expect(result.resultText).toBe('done');
    expect(result.structuredOutput).toEqual({ ok: true });
    // The generator is released rather than left dangling — teardown is detached
    // from the caller's promise, so it settles just after the result is returned.
    await closed;
  });

  it('returns when the caller aborts while the stream is silent', async () => {
    queryMock.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: async () => forever(), // nothing ever arrives again
        return: async () => ({ done: true, value: undefined }),
      }),
    });

    const controller = new AbortController();
    const promise = streamSdkQuery({
      prompt: 'hi',
      queryOptions: {},
      emitEvent: () => {},
      abortSignal: controller.signal,
    });

    // Before the fix this abort was a no-op: the only `aborted` check sat at the
    // top of the loop, which a suspended generator never reaches again.
    controller.abort(new Error('timeout'));

    const result = await promise;
    expect(result.exitReason).toBe('abort');
  });

  it('hands the SDK an AbortController so the abort actually kills the subprocess', async () => {
    let sdkAbort: AbortController | undefined;
    let onQueried!: () => void;
    const queried = new Promise<void>((r) => { onQueried = r; });
    queryMock.mockImplementation((args: { options: Record<string, unknown> }) => {
      sdkAbort = args.options['abortController'] as AbortController;
      onQueried();
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => forever(),
          return: async () => ({ done: true, value: undefined }),
        }),
      };
    });

    const controller = new AbortController();
    const promise = streamSdkQuery({
      prompt: 'hi',
      queryOptions: {},
      emitEvent: () => {},
      abortSignal: controller.signal,
    });

    // The SDK is imported dynamically, so wait for `query()` to actually be reached.
    await queried;
    expect(sdkAbort).toBeInstanceOf(AbortController);

    // Aborting the caller's signal must propagate into the SDK's own controller
    // while the query is live — otherwise the timeout stops our loop but leaves
    // the `claude` child (and its SDK concurrency slot) alive.
    controller.abort(new Error('timeout'));
    expect(sdkAbort!.signal.aborted).toBe(true);

    await promise;
  });

  it('reports `generator-end` when the stream dies without producing a result', async () => {
    queryMock.mockReturnValue({
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: true, value: undefined }),
        return: async () => ({ done: true, value: undefined }),
      }),
    });

    const result = await streamSdkQuery({ prompt: 'hi', queryOptions: {}, emitEvent: () => {} });

    expect(result.exitReason).toBe('generator-end');
    expect(result.messageCount).toBe(0);
  });
});

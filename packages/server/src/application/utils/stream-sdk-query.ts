import type { AgentEventType } from '@fleex/shared';
import type { PromptContentBlock } from './resolve-file-references.js';

/**
 * SDK instrumentation captured from the final `result` message of a `query()`
 * stream. All optional because a crashed/aborted run may never reach it.
 */
export interface SdkQueryMetrics {
  durationMs?: number;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/**
 * Compact a possibly-huge CLI stderr blob for logs/UI. A stream-json parse
 * failure echoes the entire (base64-heavy) input on one line, so the useful
 * bits are the error prefix and the trailing reason; the middle is noise. Keeps
 * the head and tail, eliding the middle.
 */
export function summarizeStderr(raw: string, keep = 4096): string {
  const s = raw.trim();
  if (s.length <= keep * 2 + 100) return s;
  const elidedKB = Math.round((s.length - keep * 2) / 1024);
  return `${s.slice(0, keep)}\n\n…[${elidedKB} KB elided]…\n\n${s.slice(-keep)}`;
}

export interface StreamSdkQueryResult {
  /** Session id captured from the SDK `init` message, if any. */
  sessionId?: string;
  resultText: string;
  structuredOutput: Record<string, unknown> | null;
  /** Subtype of the final result message (e.g. `error_max_structured_output_retries`). */
  resultSubtype?: string;
  /**
   * Last `SDKAssistantMessage.error` seen on the stream — a structured SDK code
   * (`rate_limit`, `authentication_failed`, …). It is the most trustworthy crash
   * signal available, ranked above the regex layer in `classifyCrash`. The last
   * one wins: a run can recover from a transient error and die of another cause.
   */
  lastAssistantError?: string;
  metrics: SdkQueryMetrics;
  /** Total SDK messages iterated (useful to detect a zero-message crash). */
  messageCount: number;
  /**
   * stderr text captured from the spawned Claude Code CLI subprocess. Normally
   * the SDK discards the child's stderr (stdio `"ignore"`); we opt into it so a
   * crash ("exited with code 1") carries the real reason instead of an opaque
   * exit code. Empty string when the CLI wrote nothing to stderr.
   */
  stderr: string;
}

export interface StreamSdkQueryParams {
  prompt: string | PromptContentBlock[];
  /** Already-built SDK options (model, systemPrompt, cwd, resume, …). */
  queryOptions: Record<string, unknown>;
  /**
   * Called for every intermediate SDK message so the Execution Log gets the
   * same rich, real-time stream regardless of the caller (persona, skill,
   * workflow step, panel member, panel orchestrator).
   */
  emitEvent: (eventType: AgentEventType, data: unknown) => Promise<void> | void;
  /** When provided, the loop stops as soon as the signal aborts. */
  abortSignal?: AbortSignal;
  /** session_id stamped on the wrapped multimodal user message (resume hint). */
  fallbackSessionId?: string;
  /** Invoked the moment the SDK session id is known (lets callers persist it). */
  onSessionId?: (sessionId: string) => void;
}

/**
 * Single source of truth for consuming a Claude Agent SDK `query()` stream and
 * turning each message into an `agent_event`. Previously every execution path
 * (persona, skill, workflow step) re-implemented this loop, and the panel path
 * (`RunPanel.querySDK`) consumed the stream *silently* — which is why a panel
 * member's execution log only ever showed `execution_start` + `execution_end`.
 *
 * Factoring it here guarantees parity: turn_start, content_block_delta and
 * message_stop events are emitted identically for all callers.
 */
export async function streamSdkQuery(params: StreamSdkQueryParams): Promise<StreamSdkQueryResult> {
  const { prompt, queryOptions, emitEvent, abortSignal, fallbackSessionId, onSessionId } = params;
  const { query } = await import('@anthropic-ai/claude-agent-sdk');

  let sessionId: string | undefined;
  let resultText = '';
  let structuredOutput: Record<string, unknown> | null = null;
  let resultSubtype: string | undefined;
  let lastAssistantError: string | undefined;
  let messageCount = 0;
  const metrics: SdkQueryMetrics = {};

  // Capture the CLI subprocess stderr. By default the SDK sets the child's
  // stderr to stdio `"ignore"` (discarded), so a startup crash surfaces only as
  // "Claude Code process exited with code 1" with no reason. Providing an
  // `stderr` callback flips it to a drained pipe and lets us keep the real
  // error (e.g. stream-json stdin parse failure) for logs and the UI.
  let stderrBuf = '';
  const MAX_STDERR = 4 * 1024 * 1024; // safety cap; a single CLI error line can be ~0.5 MB
  (queryOptions as Record<string, unknown>)['stderr'] = (chunk: string) => {
    stderrBuf += chunk;
    if (stderrBuf.length > MAX_STDERR) stderrBuf = stderrBuf.slice(-MAX_STDERR);
  };
  // stderr keeps arriving on the pipe after the subprocess-exit error is thrown;
  // wait for it to stop growing (bounded) so we capture the full reason, not a
  // partial/empty snapshot.
  const waitForStderrFlush = async () => {
    let prev = -1;
    for (let i = 0; i < 25 && prev !== stderrBuf.length; i++) {
      prev = stderrBuf.length;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };

  // Multimodal prompts must be wrapped in an SDKUserMessage async iterable.
  const promptArg = Array.isArray(prompt)
    ? (async function* () {
        yield {
          type: 'user' as const,
          message: { role: 'user' as const, content: prompt },
          parent_tool_use_id: null,
          session_id: fallbackSessionId ?? '',
        };
      })()
    : prompt;

  try {
    for await (const message of query({
      prompt: promptArg,
      options: queryOptions as Parameters<typeof query>[0]['options'],
    })) {
      if (abortSignal?.aborted) break;
      messageCount++;
      const msg = message as Record<string, unknown>;

      if (msg['type'] === 'system' && msg['subtype'] === 'init' && msg['session_id']) {
        sessionId = msg['session_id'] as string;
        onSessionId?.(sessionId);
        await emitEvent('turn_start', { sessionId });
      }

      // Structured SDK error code, when the assistant reports one.
      if (msg['type'] === 'assistant' && typeof msg['error'] === 'string' && msg['error']) {
        lastAssistantError = msg['error'] as string;
      }

      if ('result' in message) {
        resultText = (message as { result: string }).result;
        resultSubtype = msg['subtype'] as string | undefined;

        if (msg['structured_output']) {
          structuredOutput = msg['structured_output'] as Record<string, unknown>;
        }

        if (typeof msg['duration_ms'] === 'number') metrics.durationMs = msg['duration_ms'] as number;
        if (typeof msg['total_cost_usd'] === 'number') metrics.costUsd = msg['total_cost_usd'] as number;

        // modelUsage carries cumulative per-model token totals.
        const modelUsage = msg['modelUsage'] as Record<string, Record<string, number>> | undefined;
        if (modelUsage) {
          let totalIn = 0, totalOut = 0, totalCacheRead = 0, totalCacheCreation = 0;
          for (const mu of Object.values(modelUsage)) {
            totalIn += mu['inputTokens'] ?? 0;
            totalOut += mu['outputTokens'] ?? 0;
            totalCacheRead += mu['cacheReadInputTokens'] ?? 0;
            totalCacheCreation += mu['cacheCreationInputTokens'] ?? 0;
          }
          metrics.inputTokens = totalIn;
          metrics.outputTokens = totalOut;
          metrics.cacheReadTokens = totalCacheRead;
          metrics.cacheCreationTokens = totalCacheCreation;
        }

        await emitEvent('message_stop', { result: resultText, subtype: resultSubtype });
      } else {
        await emitEvent('content_block_delta', msg);
      }
    }
  } catch (err) {
    // Attach the captured CLI stderr so the reason survives everywhere the
    // thrown error is handled (server.log + the `error` agent event → UI),
    // instead of a bare "Claude Code process exited with code 1".
    await waitForStderrFlush();
    const summary = summarizeStderr(stderrBuf);
    if (summary) {
      const augmented = err instanceof Error ? err : new Error(String(err));
      augmented.message = `${augmented.message}\n\n[Claude CLI stderr]\n${summary}`;
      throw augmented;
    }
    throw err;
  }

  return { sessionId, resultText, structuredOutput, resultSubtype, lastAssistantError, metrics, messageCount, stderr: stderrBuf };
}

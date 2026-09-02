import type { LoggerPort } from '../ports/logger.port.js';
import type { SdkConcurrencyLimiter } from '../services/sdk-concurrency-limiter.js';
import type { MemorySnippet } from '../use-cases/retrieve-context.js';

/** Cheap and fast: every one of these tasks is reading and rewriting, not reasoning. */
const MODEL = 'claude-haiku-4-5-20251001';

/**
 * Output that means "there is nothing worth producing here".
 *
 * A sentinel rather than an empty string, because an empty response is
 * indistinguishable from a failed call. Letting the model decline explicitly is
 * what keeps these features from manufacturing a document, or a memory
 * amendment, out of material that did not support one.
 */
export const NOTHING_SENTINEL = 'NOTHING';

export interface SynthesisRequest {
  /** What the model is being asked to write, as a system prompt. */
  systemPrompt: string;
  /** The task and its evidence. */
  userPrompt: string;
}

/**
 * One non-agentic model call over retrieved text.
 *
 * Shared by every memory feature that reads the index and writes prose, so they
 * all get the same guarantees: no tools, no agentic turns, one concurrency slot,
 * and a declined result reported as such rather than as a failure. Giving any of
 * them tools would let the model leave the evidence it is supposed to be
 * summarising.
 */
export class MemorySynthesiser {
  constructor(
    private readonly sdkLimiter: SdkConcurrencyLimiter,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Returns the model's prose, or null when it declined or the call failed.
   *
   * The two are collapsed on purpose at this layer: callers that need to tell
   * them apart pass a sentinel-aware prompt and check the reason themselves.
   */
  async run(request: SynthesisRequest, context: Record<string, unknown> = {}): Promise<string | null> {
    const release = await this.sdkLimiter.acquire();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      let resultText = '';
      for await (const message of query({
        prompt: request.userPrompt,
        options: {
          model: MODEL,
          systemPrompt: request.systemPrompt,
          allowedTools: [],
          permissionMode: 'dontAsk' as const,
          maxTurns: 0,
        },
      })) {
        if ('result' in message) resultText = (message as { result: string }).result;
      }

      const trimmed = resultText.trim();
      if (!trimmed || trimmed === NOTHING_SENTINEL) return null;
      return trimmed;
    } catch (error) {
      this.logger.error('Memory synthesis call failed', {
        ...context,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      release();
    }
  }
}

/**
 * Render retrieved excerpts as numbered, attributed evidence.
 *
 * Shared so every feature cites the same way: the number the model sees is the
 * index of the snippet in the array the caller keeps, which is what lets a
 * citation be resolved back to something openable.
 */
export function renderEvidence(snippets: MemorySnippet[]): string {
  return snippets
    .map((s, i) => {
      const origin = [s.sourceKind.replace(/_/g, ' '), s.repo, s.updatedAt?.slice(0, 10)]
        .filter(Boolean)
        .join(' — ');
      return `[${i + 1}] ${s.title}\n(${origin})\n${s.content}`;
    })
    .join('\n\n---\n\n');
}

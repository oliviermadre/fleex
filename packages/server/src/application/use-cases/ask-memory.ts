import type { LoggerPort } from '../ports/logger.port.js';
import type { SdkConcurrencyLimiter } from '../services/sdk-concurrency-limiter.js';
import type { MemorySnippet, RetrieveContextUseCase } from './retrieve-context.js';

/** Cheap and fast: this is summarisation over retrieved text, not reasoning. */
const MODEL = 'claude-haiku-4-5-20251001';

/** How many chunks are handed to the synthesiser. */
const DEFAULT_LIMIT = 12;

const SYSTEM_PROMPT = `
You answer questions about a developer's own work, using only the excerpts provided.

Rules:
- Ground every claim in the excerpts. Never add knowledge from outside them.
- Cite the sources you used by their bracketed number, e.g. [2].
- When the excerpts do not answer the question, say so plainly and state what they
  do cover. Do not speculate to fill the gap.
- Be concise: a short answer with citations beats a thorough guess.
`.trim();

export interface AskMemoryResult {
  /** Prose answer with bracketed citations, or null when nothing was retrieved. */
  answer: string | null;
  /** The excerpts handed to the model, in citation order. */
  sources: MemorySnippet[];
  /** Set when no answer could be produced, so a caller can explain why. */
  reason?: 'no_results' | 'synthesis_failed' | 'unavailable';
}

/**
 * Answers a question from the instance's own memory, with citations.
 *
 * Retrieval and synthesis are kept in one use case because the citations only
 * mean anything if the numbering the model was given is the numbering the caller
 * reports — splitting them would let the two drift.
 *
 * The retrieved excerpts are the *only* permitted evidence. That is what makes
 * the answer auditable: every claim can be traced to a source the user can open,
 * and "the memory does not contain this" is a valid, useful answer rather than a
 * failure to hide behind invention.
 */
export class AskMemoryUseCase {
  constructor(
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly sdkLimiter: SdkConcurrencyLimiter,
    private readonly logger: LoggerPort,
  ) {}

  async execute(params: { question: string; limit?: number; repo?: string | null }): Promise<AskMemoryResult> {
    const question = params.question.trim();
    if (!question) return { answer: null, sources: [], reason: 'no_results' };

    if (!this.retrieveContext.isSemanticEnabled()) {
      return { answer: null, sources: [], reason: 'unavailable' };
    }

    const retrieved = await this.retrieveContext.search({
      query: question,
      limit: params.limit ?? DEFAULT_LIMIT,
      repo: params.repo ?? null,
    });
    if (retrieved.length === 0) return { answer: null, sources: [], reason: 'no_results' };

    const answer = await this.synthesise(question, retrieved);
    if (!answer) return { answer: null, sources: retrieved, reason: 'synthesis_failed' };

    return { answer, sources: retrieved };
  }

  /**
   * One non-agentic SDK call: no tools, no turns. The model's whole job is to
   * read the excerpts and answer, so giving it tools would only let it wander off
   * the evidence the citations promise.
   */
  private async synthesise(question: string, sources: MemorySnippet[]): Promise<string | null> {
    const release = await this.sdkLimiter.acquire();
    try {
      const { query } = await import('@anthropic-ai/claude-agent-sdk');
      let resultText = '';
      for await (const message of query({
        prompt: buildPrompt(question, sources),
        options: {
          model: MODEL,
          systemPrompt: SYSTEM_PROMPT,
          allowedTools: [],
          permissionMode: 'dontAsk' as const,
          maxTurns: 0,
        },
      })) {
        if ('result' in message) resultText = (message as { result: string }).result;
      }
      return resultText.trim() || null;
    } catch (error) {
      this.logger.error('Memory synthesis failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      release();
    }
  }
}

/**
 * Number the excerpts so the model can cite them, and label each with its origin
 * so a citation resolves to something the user can actually open.
 */
export function buildPrompt(question: string, sources: MemorySnippet[]): string {
  const excerpts = sources
    .map((s, i) => {
      const origin = [s.sourceKind.replace(/_/g, ' '), s.repo, s.updatedAt?.slice(0, 10)]
        .filter(Boolean)
        .join(' — ');
      return `[${i + 1}] ${s.title}\n(${origin})\n${s.content}`;
    })
    .join('\n\n---\n\n');

  return `Question: ${question}\n\nExcerpts from this workspace:\n\n${excerpts}\n\n---\nAnswer the question using only the excerpts above, citing them by number.`;
}

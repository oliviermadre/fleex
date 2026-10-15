import type { ThreadParticipant } from '@fleex/shared';
import type { ThreadStorePort } from '../ports/thread-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';
import type { SdkConcurrencyLimiter } from '../services/sdk-concurrency-limiter.js';

/**
 * Participants of a thread = distinct authors (users and agents) of the comments
 * carrying its `threadId`, in order of first appearance. Computed from the comments
 * rather than maintained on every write: there is no second source to keep in sync.
 */
export function computeParticipants(
  comments: ReadonlyArray<{ threadId: string | null; authorType: string; authorName: string }>,
  threadId: string,
): ThreadParticipant[] {
  const seen = new Map<string, ThreadParticipant>();
  for (const c of comments) {
    if (c.threadId !== threadId) continue;
    const userId = `${c.authorType}:${c.authorName}`;
    if (!seen.has(userId)) seen.set(userId, { userId, displayName: c.authorName });
  }
  return [...seen.values()];
}

const MODEL = 'claude-haiku-5-5';
const MAX_TITLE_LENGTH = 80;

const SYSTEM_PROMPT = `You name conversation threads. Given the brief of a thread and its first user message,
answer with ONE short title (max 8 words), in the language of the message, no quotes, no trailing punctuation.
Answer with the title only.`;

/** One-shot Haiku completion through the Agent SDK (same auth as the other agents). */
export type TitleCompletion = (prompt: string) => Promise<string>;

export const completeWithHaiku: TitleCompletion = async (prompt) => {
  const { query } = await import('@anthropic-ai/claude-agent-sdk');
  let resultText = '';
  for await (const message of query({
    prompt,
    options: { model: MODEL, systemPrompt: SYSTEM_PROMPT, allowedTools: [], permissionMode: 'dontAsk' as const, maxTurns: 0 },
  })) {
    if ('result' in message) resultText = (message as { result: string }).result;
  }
  return resultText;
};

export function cleanTitle(raw: string): string | null {
  const t = raw.trim().replace(/^["'«»“”]+|["'«»“”.]+$/g, '').replace(/\s+/g, ' ');
  return t ? t.slice(0, MAX_TITLE_LENGTH) : null;
}

/**
 * Names a thread once, in the background, from its brief and first user message.
 * Never throws and never blocks the caller: on any failure the title stays null and the
 * UI falls back to the brief. A thread already titled, or being titled, is left alone.
 */
export class GenerateThreadTitleUseCase {
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly threadStore: ThreadStorePort,
    private readonly sdkLimiter: SdkConcurrencyLimiter,
    private readonly eventBus: EventBus,
    private readonly logger: LoggerPort,
    private readonly complete: TitleCompletion = completeWithHaiku,
  ) {}

  /** Fire-and-forget entry point. */
  trigger(threadId: string, firstMessage: string): void {
    void this.execute(threadId, firstMessage).catch(() => {});
  }

  async execute(threadId: string, firstMessage: string): Promise<void> {
    if (this.inFlight.has(threadId)) return;
    this.inFlight.add(threadId);
    let release: (() => void) | null = null;
    try {
      const thread = await this.threadStore.getById(threadId);
      if (!thread || thread.generatedTitle) return;
      release = await this.sdkLimiter.acquire();
      const title = cleanTitle(await this.complete(`Brief:\n${thread.brief}\n\nFirst user message:\n${firstMessage}`));
      if (!title) return;
      // Re-read: the thread may have moved on while Haiku was thinking; write the title only.
      const fresh = await this.threadStore.getById(threadId);
      if (!fresh || fresh.generatedTitle) return;
      fresh.generatedTitle = title;
      await this.threadStore.save(fresh);
      this.eventBus.emit({ type: 'thread.updated', threadId, ticketId: fresh.ticketId, occurredAt: new Date() });
    } catch (err) {
      this.logger.warn('Thread title generation failed', { threadId, error: err instanceof Error ? err.message : String(err) });
    } finally {
      release?.();
      this.inFlight.delete(threadId);
    }
  }
}

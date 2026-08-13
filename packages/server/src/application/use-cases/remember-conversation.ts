import type { LoggerPort } from '../ports/logger.port.js';
import { chunkAssistantDigest } from '../memory/chunk-curated.js';
import type { MemoryKernel } from '../memory/memory-kernel.js';
import { MemorySynthesiser, NOTHING_SENTINEL } from '../memory/memory-synthesiser.js';
import type { RetrieveContextUseCase } from './retrieve-context.js';

/** Beyond this, only the tail of a conversation is distilled. */
const MAX_TRANSCRIPT_CHARS = 30_000;

const SYSTEM_PROMPT = `
You distil a conversation between a developer and their assistant into a short
note for long-term memory.

Keep only what is still true and useful after the conversation ends:
- stated preferences ("always branch off develop", "I prefer sessions to JWT")
- decisions reached, and the reason for them
- facts about this workspace the assistant had to be told
- corrections the developer made to the assistant

Discard everything else: navigation, tool calls, restated questions, pleasantries,
and anything specific to a single request that will not recur.

Write terse markdown bullets, under 200 words, in the developer's own terms. No
preamble, no code fence.

If the conversation contains nothing worth remembering later, output the single
token ${NOTHING_SENTINEL}.
`.trim();

/** One turn of a conversation, as the assistant host records it. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface RememberResult {
  ok: boolean;
  /** The distilled note, when one was worth keeping. */
  digest?: string;
  reason?: 'unavailable' | 'empty' | 'nothing_to_remember';
}

/**
 * Gives the assistant a memory that survives its conversations.
 *
 * The assistant currently starts every conversation blank: preferences stated
 * yesterday have to be restated today, and a correction has to be repeated each
 * time the subject comes up. This distils each conversation as it ends and indexes
 * the result, so the next one begins with what the last one established.
 *
 * A digest, never the transcript. A conversation is mostly the process of getting
 * to an answer — "show me that ticket", "no, the other one" — and indexing that
 * would bury the two sentences that mattered. The model is also allowed to decline:
 * most conversations establish nothing durable, and a memory filled with
 * "the developer asked about a ticket" is worse than an empty one.
 */
export class RememberConversationUseCase {
  constructor(
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly synthesiser: MemorySynthesiser,
    private readonly logger: LoggerPort,
    private readonly kernel?: MemoryKernel,
  ) {}

  async execute(params: {
    conversationId: string;
    title?: string;
    turns: ConversationTurn[];
    repo?: string | null;
  }): Promise<RememberResult> {
    if (!this.kernel || !this.retrieveContext.isFeatureEnabled('assistantMemory')) {
      return { ok: false, reason: 'unavailable' };
    }

    const transcript = renderTranscript(params.turns);
    if (!transcript) return { ok: false, reason: 'empty' };

    const digest = await this.synthesiser.run(
      { systemPrompt: SYSTEM_PROMPT, userPrompt: `${transcript}\n\n---\nDistil this conversation now.` },
      { conversationId: params.conversationId },
    );
    if (!digest) {
      // Most conversations legitimately establish nothing durable. Replacing any
      // previous digest with nothing would also be wrong, so leave it be.
      return { ok: false, reason: 'nothing_to_remember' };
    }

    const drafts = chunkAssistantDigest({
      conversationId: params.conversationId,
      title: params.title?.trim() || 'Conversation',
      content: digest,
      repo: params.repo ?? null,
      endedAt: new Date(),
    });

    // Keyed on the conversation id, so re-distilling a continued conversation
    // replaces its digest rather than accumulating stale versions of it.
    await this.kernel.ingest('assistant_conversation', params.conversationId, drafts);
    this.logger.info('Remembered an assistant conversation', {
      conversationId: params.conversationId, chunks: drafts.length,
    });
    return { ok: true, digest };
  }

  /** Drop a conversation's digest — used when the conversation is deleted. */
  async forget(conversationId: string): Promise<void> {
    await this.kernel?.forget('assistant_conversation', conversationId);
  }
}

/**
 * Render turns for the distiller, keeping the end when a conversation is long.
 *
 * The tail is what matters: conclusions and corrections land late, whereas the
 * opening is usually orientation. Truncating from the front therefore loses the
 * least.
 */
export function renderTranscript(turns: ConversationTurn[]): string {
  const rendered = turns
    .filter((t) => t.content.trim())
    .map((t) => `**${t.role}**: ${t.content.trim()}`)
    .join('\n\n');

  if (rendered.length <= MAX_TRANSCRIPT_CHARS) return rendered;
  return `…(earlier turns omitted)…\n\n${rendered.slice(-MAX_TRANSCRIPT_CHARS)}`;
}

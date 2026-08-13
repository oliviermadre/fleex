import type { DraftChunk } from './chunker.js';
import { splitMarkdown } from './chunker.js';

/**
 * Tag marking content a human chose to keep.
 *
 * Curated notes and assistant digests are not just more text: someone decided
 * they were worth remembering. The tag lets that judgement participate in
 * ranking instead of being flattened into the corpus average.
 */
export const CURATED_TAG = 'curated';

export interface CuratedNoteInput {
  /** Stable id of the note — the execution or conversation it was cut from. */
  id: string;
  title: string;
  content: string;
  /** Free-text note the user added when saving. Indexed with the content. */
  comment?: string | null;
  ticketId?: string | null;
  repo?: string | null;
  agentName?: string | null;
  createdAt?: Date | null;
}

/**
 * Chunk a note a user promoted out of a run.
 *
 * The user's own comment goes first in the text: it is why the note was kept, so
 * it is also the best summary of what the note is about — and short chunks
 * retrieve on their opening far more than on their tail.
 */
export function chunkCuratedNote(input: CuratedNoteInput): DraftChunk[] {
  const body = [input.comment?.trim(), input.content.trim()].filter(Boolean).join('\n\n');
  if (!body) return [];

  const parts = splitMarkdown(body);
  return parts.map((content, chunkIndex) => ({
    sourceKind: 'curated_note' as const,
    sourceId: input.id,
    chunkIndex,
    title: parts.length > 1 ? `${input.title} (${chunkIndex + 1}/${parts.length})` : input.title,
    content,
    metadata: {
      ticketId: input.ticketId ?? null,
      repo: input.repo ?? null,
      agentName: input.agentName ?? null,
      tags: [CURATED_TAG],
    },
    sourceUpdatedAt: input.createdAt ?? null,
  }));
}

export interface AssistantDigestInput {
  conversationId: string;
  title: string;
  /** The distilled conversation — preferences, decisions, conclusions. */
  content: string;
  repo?: string | null;
  endedAt?: Date | null;
}

/**
 * Chunk a digest of an assistant conversation.
 *
 * Digests, not transcripts: a conversation is mostly navigation — "show me that
 * ticket", "no, the other one" — and indexing it whole would drown the decisions
 * it contains in the process of reaching them.
 */
export function chunkAssistantDigest(input: AssistantDigestInput): DraftChunk[] {
  const body = input.content.trim();
  if (!body) return [];

  const parts = splitMarkdown(body);
  return parts.map((content, chunkIndex) => ({
    sourceKind: 'assistant_conversation' as const,
    sourceId: input.conversationId,
    chunkIndex,
    title: parts.length > 1
      ? `Assistant: ${input.title} (${chunkIndex + 1}/${parts.length})`
      : `Assistant: ${input.title}`,
    content,
    metadata: {
      repo: input.repo ?? null,
      tags: [CURATED_TAG],
    },
    sourceUpdatedAt: input.endedAt ?? null,
  }));
}

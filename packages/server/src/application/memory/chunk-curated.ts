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

export interface QaPairInput {
  /** The mention that was waiting — the identity of this exchange. */
  mentionId: string;
  ticketId: string;
  ticketTitle: string;
  ticketDisplayId?: number | string | null;
  agentName: string;
  /** What the agent asked for before it paused. */
  question: string;
  /** The reply that unblocked it. */
  answer: string;
  repo?: string | null;
  boardId?: string | null;
  tags?: string[];
  answeredAt?: Date | null;
}

/**
 * Chunk a question an agent asked and the answer it got.
 *
 * These exchanges are the workspace's FAQ, and they were being lost: the pairing
 * exists only for the instant an agent wakes, then dissolves back into an
 * ordinary comment thread where the question and its answer may be separated by
 * a dozen unrelated messages.
 *
 * Kept as one chunk, never split. A question without its answer retrieves as an
 * open problem, and an answer without its question retrieves as an assertion
 * about nothing — the pair only means something whole.
 */
export function chunkQaPair(input: QaPairInput): DraftChunk[] {
  const question = input.question.trim();
  const answer = input.answer.trim();
  if (!question || !answer) return [];

  const label = input.ticketDisplayId ? `Ticket #${input.ticketDisplayId}` : 'Ticket';
  return [{
    sourceKind: 'qa_pair',
    sourceId: input.mentionId,
    chunkIndex: 0,
    title: `${label}: ${input.ticketTitle} > ${input.agentName} asked`,
    content: `**Question** (${input.agentName}):\n${question}\n\n**Answer**:\n${answer}`,
    metadata: {
      ticketId: input.ticketId,
      boardId: input.boardId ?? null,
      repo: input.repo ?? null,
      agentName: input.agentName,
      // Tagged as curated: an answered question is settled knowledge, which is
      // worth more at equal relevance than the discussion around it.
      tags: [...(input.tags ?? []), CURATED_TAG],
    },
    sourceUpdatedAt: input.answeredAt ?? null,
  }];
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

import type { DraftChunk } from './chunker.js';
import { HUMAN_FEEDBACK_TAG, MAX_CHUNK_CHARS, splitMarkdown } from './chunker.js';

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
  /**
   * The agent's own question could not be found, so `question` holds the human
   * request that started the exchange instead. Labelled as such, so the chunk
   * never puts a human's words in the agent's mouth.
   */
  requestOnly?: boolean;
  /** Who wrote the request, when `requestOnly` is set. */
  requesterName?: string | null;
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
    content: input.requestOnly
      ? `**Request** (${input.requesterName ?? 'user'}):\n${question}\n\n**Answer**:\n${answer}`
      : `**Question** (${input.agentName}):\n${question}\n\n**Answer**:\n${answer}`,
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

export interface CorrectionInput {
  /** The mention the correction created — the identity of this exchange. */
  mentionId: string;
  ticketId: string;
  ticketTitle: string;
  ticketDisplayId?: number | string | null;
  /** The agent that was corrected. */
  agentName: string;
  /** Who corrected it. */
  humanName: string;
  /** The generalisable lesson the judge drew from the exchange. */
  lesson: string;
  /** What the agent had said, when the correction replies to it directly. */
  agentSaid?: string | null;
  correction: string;
  response: string;
  repo?: string | null;
  boardId?: string | null;
  tags?: string[];
  respondedAt?: Date | null;
}

/** Per-block ceilings, so the whole correction fits one chunk. */
const SAID_MAX = 400;
const CORRECTION_MAX = 700;
const RESPONSE_MAX = 500;

/**
 * Chunk a correction a human made without being asked.
 *
 * An agent asks when it doubts; when it is confidently wrong it asks nothing, and
 * the human steps in. That exchange is the most valuable lesson an agent can get,
 * and until now it left no trace but a comment in a thread.
 *
 * The lesson leads, because a short chunk retrieves on its opening. Kept as one
 * chunk: the lesson without the exchange is an unsupported claim, and the coach
 * is told to check one against the other.
 */
export function chunkCorrection(input: CorrectionInput): DraftChunk[] {
  const lesson = input.lesson.trim();
  const correction = input.correction.trim();
  const response = input.response.trim();
  if (!lesson || !correction || !response) return [];

  const blocks = {
    said: truncate(input.agentSaid?.trim() ?? '', SAID_MAX),
    response: truncate(response, RESPONSE_MAX),
    correction: truncate(correction, CORRECTION_MAX),
  };
  const render = () => [
    `**Lesson**: ${lesson}`,
    blocks.said ? `**Agent said** (${input.agentName}):\n${blocks.said}` : null,
    `**Human correction** (${input.humanName}):\n${blocks.correction}`,
    `**Agent response** (${input.agentName}):\n${blocks.response}`,
  ].filter(Boolean).join('\n\n');

  // Over the ceiling, give up context in order of how little it adds: the
  // original claim first (the correction restates it), then the reply, and the
  // correction itself last.
  let content = render();
  for (const key of ['said', 'response', 'correction'] as const) {
    const excess = content.length - MAX_CHUNK_CHARS;
    if (excess <= 0) break;
    blocks[key] = truncate(blocks[key], Math.max(0, blocks[key].length - excess - 1));
    content = render();
  }
  content = content.slice(0, MAX_CHUNK_CHARS);

  const label = input.ticketDisplayId ? `Ticket #${input.ticketDisplayId}` : 'Ticket';
  return [{
    sourceKind: 'correction',
    sourceId: input.mentionId,
    chunkIndex: 0,
    title: `${label}: ${input.ticketTitle} > ${input.humanName} corrected ${input.agentName}`,
    content,
    metadata: {
      ticketId: input.ticketId,
      boardId: input.boardId ?? null,
      repo: input.repo ?? null,
      agentName: input.agentName,
      tags: [...new Set([...(input.tags ?? []), CURATED_TAG, HUMAN_FEEDBACK_TAG])],
    },
    sourceUpdatedAt: input.respondedAt ?? null,
  }];
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= 1) return '';
  return `${text.slice(0, max - 1)}…`;
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

export interface CliSessionInput {
  sessionId: string;
  /** Repository the session ran in, when it could be resolved from the cwd. */
  repo?: string | null;
  /** The distilled session — what was done and what it established. */
  content: string;
  endedAt?: Date | null;
}

/**
 * Chunk a terminal session that belonged to no ticket.
 *
 * A session run in a plain checkout is invisible to Fleex today: the cost hook
 * finds no `.fleex.json`, discards the transcript, and everything learned in it is
 * gone. Yet it is often where the exploratory work happens — reading unfamiliar
 * code, chasing a build failure — and the findings are exactly what a later run
 * would want.
 *
 * Scoped by repository rather than by ticket, because that is the only anchor such
 * a session has, and it is the anchor that matters: the next agent working in the
 * same checkout is who this is for.
 */
export function chunkCliSession(input: CliSessionInput): DraftChunk[] {
  const body = input.content.trim();
  if (!body) return [];

  const label = input.repo ?? 'terminal';
  const parts = splitMarkdown(body);
  return parts.map((content, chunkIndex) => ({
    sourceKind: 'cli_session_summary' as const,
    sourceId: `cli:${input.sessionId}`,
    chunkIndex,
    title: parts.length > 1
      ? `Terminal session in ${label} (${chunkIndex + 1}/${parts.length})`
      : `Terminal session in ${label}`,
    content,
    metadata: {
      repo: input.repo ?? null,
      tags: [CURATED_TAG],
    },
    sourceUpdatedAt: input.endedAt ?? null,
  }));
}

import type { MemoryChunkMetadata, MemorySourceKind } from '../../domain/entities/memory-chunk.entity.js';

/**
 * Target chunk size in characters. Roughly 380 tokens at the usual four
 * characters per token — comfortably inside the 512-token window of the small
 * multilingual encoders, with room for the breadcrumb prefix.
 */
export const TARGET_CHUNK_CHARS = 1500;

/** Below this, a trailing fragment is merged back instead of standing alone. */
const MIN_TAIL_CHARS = 200;

/**
 * Hard ceiling on a chunk, including the tail merge.
 *
 * Roughly 450 tokens, so a chunk plus its breadcrumb prefix still fits the
 * 512-token window of the small encoders. Anything above that is silently
 * truncated by the model, which loses the end of the text without any error —
 * the merge below must never trade a runt chunk for that.
 */
export const MAX_CHUNK_CHARS = Math.round(TARGET_CHUNK_CHARS * 1.2);

export interface DraftChunk {
  sourceKind: MemorySourceKind;
  sourceId: string;
  chunkIndex: number;
  /** Breadcrumb shown in the UI and prefixed onto the embedded text. */
  title: string;
  content: string;
  metadata: MemoryChunkMetadata;
  sourceUpdatedAt?: Date | null;
}

/**
 * The text handed to the encoder: breadcrumb first, then the content.
 *
 * Short chunks embed poorly on their own — "yes, do that" carries no topic — and
 * the breadcrumb is what anchors them to their ticket and section. Applied at
 * embed time rather than stored, so the content column stays the verbatim source
 * for display and keyword search.
 */
export function embeddableText(chunk: { title: string; content: string }): string {
  return chunk.title ? `${chunk.title}\n${chunk.content}` : chunk.content;
}

/**
 * Split markdown on its own headings, falling back to paragraph packing.
 *
 * Heading boundaries are preferred over a fixed window because a section is the
 * unit a reader would cite; cutting mid-argument produces chunks that retrieve
 * on keywords but read as nonsense once injected.
 */
export function splitMarkdown(text: string, targetChars = TARGET_CHUNK_CHARS): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= targetChars) return [trimmed];

  const sections = splitOnHeadings(trimmed);
  const out: string[] = [];
  for (const section of sections) {
    if (section.length <= targetChars) {
      out.push(section);
      continue;
    }
    out.push(...packParagraphs(section, targetChars));
  }
  return mergeShortTail(out, targetChars);
}

/** Group lines under the most recent `##`/`###` heading. */
function splitOnHeadings(text: string): string[] {
  const lines = text.split('\n');
  const sections: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    // Only h2+ splits: a single h1 title would otherwise produce one section.
    if (/^#{2,6}\s+\S/.test(line) && current.length > 0) {
      sections.push(current.join('\n').trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) sections.push(current.join('\n').trim());
  return sections.filter(Boolean);
}

/** Fill chunks paragraph by paragraph; hard-split any paragraph that overflows alone. */
function packParagraphs(text: string, targetChars: number): string[] {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  const out: string[] = [];
  let buffer = '';

  const flush = () => {
    if (buffer.trim()) out.push(buffer.trim());
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > targetChars) {
      flush();
      for (let i = 0; i < paragraph.length; i += targetChars) {
        out.push(paragraph.slice(i, i + targetChars).trim());
      }
      continue;
    }
    if (buffer.length + paragraph.length + 2 > targetChars) flush();
    buffer = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
  }
  flush();
  return out;
}

/**
 * Fold a runt final chunk into its predecessor, but only while the result stays
 * under the model's window. A lone 40-character tail retrieves on nothing; a
 * chunk truncated by the encoder loses its ending silently, which is worse.
 */
function mergeShortTail(chunks: string[], targetChars: number): string[] {
  if (chunks.length < 2) return chunks;
  const last = chunks[chunks.length - 1]!;
  const previous = chunks[chunks.length - 2]!;
  if (last.length >= MIN_TAIL_CHARS) return chunks;
  const ceiling = Math.round(targetChars * 1.2);
  if (previous.length + last.length + 2 > ceiling) return chunks;
  return [...chunks.slice(0, -2), `${previous}\n\n${last}`];
}

// ─── Per-source-kind chunkers ───

export interface TicketChunkInput {
  id: string;
  displayId?: number | string | null;
  title: string;
  description?: string | null;
  status: string;
  boardId?: string | null;
  tags?: string[];
  repo?: string | null;
  updatedAt?: Date | null;
}

/** Ticket title and description. The title is always in the breadcrumb. */
export function chunkTicket(ticket: TicketChunkInput): DraftChunk[] {
  const label = ticket.displayId ? `Ticket #${ticket.displayId}` : 'Ticket';
  const breadcrumb = `${label}: ${ticket.title}`;
  const metadata: MemoryChunkMetadata = {
    ticketId: ticket.id,
    boardId: ticket.boardId ?? null,
    repo: ticket.repo ?? null,
    tags: ticket.tags ?? [],
  };

  const body = ticket.description?.trim();
  // A ticket with no description is still worth indexing: its title is often the
  // only statement of the problem, and it is what a duplicate check matches on.
  const parts = body ? splitMarkdown(body) : [''];

  return parts.map((content, chunkIndex) => ({
    sourceKind: 'ticket' as const,
    sourceId: ticket.id,
    chunkIndex,
    title: parts.length > 1 ? `${breadcrumb} (${chunkIndex + 1}/${parts.length})` : breadcrumb,
    content: content || ticket.title,
    metadata,
    sourceUpdatedAt: ticket.updatedAt ?? null,
  }));
}

export interface CommentChunkInput {
  id: string;
  authorName: string;
  authorType: string;
  body: string;
  createdAt?: Date | null;
}

/**
 * Tag marking a thread where a human corrected an agent.
 *
 * The highest-signal memory in the instance is the moment someone said "no, not
 * like that": it records a decision the agents would otherwise keep re-deriving
 * wrongly. Carried as a tag rather than a separate source kind so it composes
 * with the existing tag-overlap scoring and stays visible in the manifest.
 */
export const HUMAN_FEEDBACK_TAG = 'human-feedback';

/**
 * Whether a thread contains a human replying after an agent spoke.
 *
 * Deliberately structural rather than semantic: judging whether a reply is a
 * *correction* would need a model call per thread, and the ordering alone —
 * agent produced something, human answered — already isolates the exchanges
 * worth ranking up. False positives are cheap here (a "thanks" ranks slightly
 * high); a missed correction is not.
 */
export function hasHumanFeedback(comments: CommentChunkInput[]): boolean {
  let sawAgent = false;
  for (const comment of comments) {
    if (comment.authorType === 'agent') sawAgent = true;
    else if (sawAgent && comment.authorType === 'user') return true;
  }
  return false;
}

/**
 * Window a ticket's comment thread.
 *
 * Comments are windowed rather than embedded one by one because a single comment
 * is frequently deictic — "yes", "do the second option" — and carries no
 * retrievable topic on its own. Consecutive comments are packed up to the target
 * size, cutting only at comment boundaries, with a one-comment overlap so an
 * exchange split across two windows stays intelligible in both.
 */
export function chunkCommentThread(
  ticket: { id: string; displayId?: number | string | null; title: string; boardId?: string | null; tags?: string[]; repo?: string | null },
  comments: CommentChunkInput[],
): DraftChunk[] {
  if (comments.length === 0) return [];

  const rendered = comments.map((c) => ({
    text: `**${c.authorName}** (${c.authorType}):\n${c.body.trim()}`,
    createdAt: c.createdAt ?? null,
  }));

  const windows: Array<{ text: string; last: Date | null }> = [];
  let buffer: string[] = [];
  let bufferLen = 0;
  let lastDate: Date | null = null;

  for (let i = 0; i < rendered.length; i++) {
    const entry = rendered[i]!;
    if (bufferLen > 0 && bufferLen + entry.text.length > TARGET_CHUNK_CHARS) {
      windows.push({ text: buffer.join('\n\n'), last: lastDate });
      // Overlap: carry the previous comment so the next window has its lead-in.
      const carry = buffer[buffer.length - 1]!;
      buffer = [carry];
      bufferLen = carry.length;
    }
    buffer.push(entry.text);
    bufferLen += entry.text.length;
    lastDate = entry.createdAt ?? lastDate;
  }
  if (buffer.length > 0) windows.push({ text: buffer.join('\n\n'), last: lastDate });

  const label = ticket.displayId ? `Ticket #${ticket.displayId}` : 'Ticket';
  const tags = [...(ticket.tags ?? [])];
  if (hasHumanFeedback(comments) && !tags.includes(HUMAN_FEEDBACK_TAG)) {
    tags.push(HUMAN_FEEDBACK_TAG);
  }
  const metadata: MemoryChunkMetadata = {
    ticketId: ticket.id,
    boardId: ticket.boardId ?? null,
    repo: ticket.repo ?? null,
    tags,
  };

  return windows.map((w, chunkIndex) => ({
    sourceKind: 'comment_thread' as const,
    sourceId: ticket.id,
    chunkIndex,
    title: `${label}: ${ticket.title} > discussion${windows.length > 1 ? ` (${chunkIndex + 1}/${windows.length})` : ''}`,
    content: w.text,
    metadata,
    sourceUpdatedAt: w.last,
  }));
}

export interface DeliverableChunkInput {
  id: string;
  title: string;
  type: string;
  content: string;
  agentName?: string | null;
  ticketId?: string | null;
  boardId?: string | null;
  repo?: string | null;
  tags?: string[];
  updatedAt?: Date | null;
  /** Origin label for the breadcrumb — a ticket title or a routine name. */
  originLabel?: string | null;
}

/**
 * Split a deliverable on its headings.
 *
 * The two summary types are deliberately never split: they are written to a
 * fixed ~400-word shape precisely so they can be retrieved and injected whole,
 * and cutting them would strand the decision from its rationale.
 */
export function chunkDeliverable(deliverable: DeliverableChunkInput): DraftChunk[] {
  const kind = summaryKind(deliverable.type);
  const metadata: MemoryChunkMetadata = {
    ticketId: deliverable.ticketId ?? null,
    boardId: deliverable.boardId ?? null,
    repo: deliverable.repo ?? null,
    agentName: deliverable.agentName ?? null,
    tags: deliverable.tags ?? [],
  };
  const origin = deliverable.originLabel ? ` (${deliverable.originLabel})` : '';
  const content = deliverable.content.trim();
  if (!content) return [];

  if (kind !== 'deliverable') {
    return [{
      sourceKind: kind,
      sourceId: deliverable.id,
      chunkIndex: 0,
      title: `${deliverable.title}${origin}`,
      content,
      metadata,
      sourceUpdatedAt: deliverable.updatedAt ?? null,
    }];
  }

  const parts = splitMarkdown(content);
  return parts.map((part, chunkIndex) => ({
    sourceKind: 'deliverable' as const,
    sourceId: deliverable.id,
    chunkIndex,
    title: `${deliverable.title}${origin}${parts.length > 1 ? ` (${chunkIndex + 1}/${parts.length})` : ''}`,
    content: part,
    metadata,
    sourceUpdatedAt: deliverable.updatedAt ?? null,
  }));
}

/** Map a deliverable type onto its dedicated source kind, when it has one. */
function summaryKind(type: string): MemorySourceKind {
  if (type === 'ticket-summary') return 'ticket_summary';
  if (type === 'cli-session-summary') return 'cli_session_summary';
  return 'deliverable';
}

/**
 * Split a scratchpad. Per-repo notes carry their repo so retrieval can be scoped
 * to what the agent currently has checked out.
 */
export function chunkScratchpad(input: {
  key: string;
  label: string;
  content: string;
  repo?: string | null;
  updatedAt?: Date | null;
}): DraftChunk[] {
  const parts = splitMarkdown(input.content);
  return parts.map((content, chunkIndex) => ({
    sourceKind: 'scratchpad' as const,
    sourceId: input.key,
    chunkIndex,
    title: `Scratchpad: ${input.label}${parts.length > 1 ? ` (${chunkIndex + 1}/${parts.length})` : ''}`,
    content,
    metadata: { repo: input.repo ?? null },
    sourceUpdatedAt: input.updatedAt ?? null,
  }));
}

/**
 * Index a persona's learned knowledge.
 *
 * `memoryMd` and `identityMd` only. `soulMd` is deliberately excluded: it sets
 * tone and behaviour, so retrieving it as knowledge would answer questions about
 * the domain with an agent's personality.
 */
export function chunkPersona(input: {
  id: string;
  name: string;
  memoryMd?: string | null;
  identityMd?: string | null;
  updatedAt?: Date | null;
}): DraftChunk[] {
  const out: DraftChunk[] = [];
  let chunkIndex = 0;

  for (const [label, body] of [['memory', input.memoryMd], ['identity', input.identityMd]] as const) {
    for (const content of splitMarkdown(body?.trim() ?? '')) {
      out.push({
        sourceKind: 'persona',
        sourceId: input.id,
        chunkIndex: chunkIndex++,
        title: `Agent ${input.name} > ${label}`,
        content,
        metadata: { agentName: input.name },
        sourceUpdatedAt: input.updatedAt ?? null,
      });
    }
  }
  return out;
}

/** Index a skill's instructions, so "how do we usually do X" finds the skill. */
export function chunkSkill(input: {
  id: string;
  commandName: string;
  displayName: string;
  markdownContent: string;
  updatedAt?: Date | null;
}): DraftChunk[] {
  const parts = splitMarkdown(input.markdownContent);
  return parts.map((content, chunkIndex) => ({
    sourceKind: 'skill' as const,
    sourceId: input.id,
    chunkIndex,
    title: `Skill /${input.commandName} — ${input.displayName}`,
    content,
    metadata: {},
    sourceUpdatedAt: input.updatedAt ?? null,
  }));
}

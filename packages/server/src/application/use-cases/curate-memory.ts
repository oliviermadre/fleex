import { randomUUID } from 'node:crypto';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import { chunkCuratedNote } from '../memory/chunk-curated.js';
import type { MemoryKernel } from '../memory/memory-kernel.js';
import type { RetrieveContextUseCase } from './retrieve-context.js';

/** Cap on how much of a run's text one note may carry. */
const MAX_NOTE_CHARS = 8_000;

export interface CurateResult {
  ok: boolean;
  /** Id of the stored note, so a caller can report or link it. */
  noteId?: string;
  reason?: 'unavailable' | 'not_found' | 'empty';
}

/**
 * Turns a moment of an execution into a first-class memory note.
 *
 * Runs already produce comments and deliverables, but the useful discovery is
 * often neither: it is a paragraph in the middle of a log — "the CI breaks
 * because the arm runner has no docker" — that nobody will ever find again. This
 * lets the reader lift that out and keep it.
 *
 * Curated notes are tagged as such, so a deliberate act of keeping something
 * carries more weight in ranking than the ambient output it was cut from. They
 * are indexed directly rather than filed as deliverables: a deliverable belongs
 * to a ticket and claims to be a work product, while this is a note about the
 * workspace that may outlive the ticket entirely.
 */
export class CurateMemoryUseCase {
  constructor(
    private readonly agentEventStore: AgentEventStorePort,
    private readonly retrieveContext: RetrieveContextUseCase,
    private readonly logger: LoggerPort,
    private readonly kernel?: MemoryKernel,
  ) {}

  /**
   * Save a note. `content` is what the reader selected; when omitted, the
   * execution's own output is distilled from its event stream.
   */
  async curate(params: {
    executionId: string;
    title?: string;
    content?: string;
    comment?: string | null;
    ticketId?: string | null;
    repo?: string | null;
    agentName?: string | null;
  }): Promise<CurateResult> {
    if (!this.kernel || !this.retrieveContext.isFeatureEnabled('curation')) {
      return { ok: false, reason: 'unavailable' };
    }

    let content = params.content?.trim() ?? '';
    if (!content) {
      content = await this.extractFromExecution(params.executionId);
    }
    if (!content) return { ok: false, reason: 'empty' };

    const noteId = `exec:${params.executionId}:${randomUUID().slice(0, 8)}`;
    const drafts = chunkCuratedNote({
      id: noteId,
      title: params.title?.trim() || `Note from execution ${params.executionId.slice(0, 8)}`,
      content: content.slice(0, MAX_NOTE_CHARS),
      comment: params.comment ?? null,
      ticketId: params.ticketId ?? null,
      repo: params.repo ?? null,
      agentName: params.agentName ?? null,
      createdAt: new Date(),
    });

    await this.kernel.ingest('curated_note', noteId, drafts);
    this.logger.info('Curated a memory note from an execution', {
      executionId: params.executionId, noteId, chunks: drafts.length,
    });
    return { ok: true, noteId };
  }

  /** Remove a curated note. Keeping a mistake is worse than never keeping it. */
  async forget(noteId: string): Promise<boolean> {
    if (!this.kernel) return false;
    await this.kernel.forget('curated_note', noteId);
    return true;
  }

  /**
   * Distil a run's own words from its event stream.
   *
   * Only the assistant's text is kept: tool calls and their results are the
   * mechanics of the run, and a note made of them would retrieve on file paths
   * rather than on what was learned.
   */
  private async extractFromExecution(executionId: string): Promise<string> {
    const events = await this.agentEventStore.getEventsByExecution(executionId);
    const parts: string[] = [];

    for (const event of events) {
      if (event.eventType !== 'content_block_delta') continue;
      const data = event.data as Record<string, unknown> | null;
      if (!data || data['type'] !== 'assistant') continue;

      const message = data['message'] as { content?: Array<Record<string, unknown>> } | undefined;
      for (const block of message?.content ?? []) {
        if (block['type'] === 'text' && typeof block['text'] === 'string') {
          parts.push(block['text']);
        }
      }
    }

    return parts.join('\n\n').trim();
  }
}

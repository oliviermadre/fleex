import { randomUUID } from 'node:crypto';
import {
  parseNotionUrl,
  NOTION_IMPORT_PENDING_TAG,
  NOTION_IMPORT_FAILED_TAG,
  isNotionImportTag,
} from '@fleex/shared';
import type { ParsedNotionUrl } from '@fleex/shared';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { NotionImportError, TicketNotFoundError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { NotionImportPort, NotionImportResult } from '../ports/notion-import.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';

/**
 * Creates a ticket from a pasted Notion page link, mirroring the Slack-message
 * import flow — **asynchronously**, because the synthesis (Claude reading the
 * page through the user's native Notion integration) routinely takes far longer
 * than an acceptable request latency.
 *
 * {@link execute} therefore persists a placeholder ticket immediately (tagged
 * {@link NOTION_IMPORT_PENDING_TAG}) and returns it, then drives the slow
 * synthesis in the background via {@link completeImport}. On completion the
 * ticket's title + description are patched and a `ticket.updated` event is
 * emitted so the front swaps in the full ticket DTO — surviving navigation. On
 * failure the ticket is tagged {@link NOTION_IMPORT_FAILED_TAG} so the UI can
 * show the failure and offer {@link retry}. Only the synthesis is ever stored;
 * raw Notion content is never persisted.
 */
export class ImportNotionPageUseCase {
  /** Wired in the container so background completions can notify the front. */
  public eventBus?: EventBus;

  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly notionImport: NotionImportPort,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Synchronously create + persist a pending placeholder ticket and kick off the
   * background synthesis. Returns the placeholder so the HTTP layer can respond
   * immediately (201) with a reload-safe ticket.
   */
  async execute(url: string, boardId: string): Promise<TicketEntity> {
    const parsed = parseNotionUrl(url);
    if (!parsed) {
      throw new NotionImportError('Not a valid Notion page link', 'NOTION_INVALID_URL');
    }

    const ticketId = randomUUID();
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 0, // assigned by createTicket() below
      title: this.placeholderTitle(),
      description: this.pendingDescription(parsed.url),
      status: 'backlog',
      tags: [NOTION_IMPORT_PENDING_TAG],
    });

    ticket.addLink(
      'notion_page',
      parsed.pageId,
      'Notion page',
      parsed.url,
      randomUUID(),
    );

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action: 'created',
      changes: { source: { from: null, to: `notion:${parsed.pageId}` } },
      source: 'web',
    }));

    this.logger.info('Notion import placeholder created, synthesizing in background', {
      pageId: parsed.pageId,
      ticketId,
    });

    // Fire-and-forget: the synthesis is too slow to await on the request path.
    // completeImport swallows its own errors, so this never rejects.
    void this.completeImport(ticketId, parsed);

    return ticket;
  }

  /**
   * Background step: run the synthesis and patch the placeholder ticket. On
   * success the synthesis becomes the description and the pending tag is
   * cleared; on any failure the ticket is flagged failed (and stays retryable).
   * Awaitable so tests can drive it deterministically.
   *
   * The synthesis takes seconds, during which the client may concurrently move
   * the ticket (e.g. the "create directly into a column" path PATCHes its
   * status right after the 201). We therefore run the synthesis FIRST and only
   * re-read + patch the ticket once it is done, so we never save a snapshot
   * captured before that move — which would silently revert the column.
   */
  async completeImport(ticketId: string, parsed: ParsedNotionUrl): Promise<void> {
    let result: NotionImportResult;
    try {
      result = await this.notionImport.synthesizePage(parsed);
    } catch (err) {
      this.logger.error('Notion synthesis threw during background import', {
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.markFailed(ticketId, 'Notion synthesis failed unexpectedly.', parsed);
      return;
    }

    if (result.status !== 'ok') {
      await this.markFailed(ticketId, this.failureReason(result), parsed);
      return;
    }

    // Re-read AFTER synthesis so a concurrent move/edit is preserved, not clobbered.
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) {
      this.logger.warn('Notion import target ticket vanished before completion', { ticketId });
      return;
    }

    const diff = ticket.update({
      title: result.title,
      description: this.buildDescription(result.synthesis, parsed.url),
      tags: this.stripImportTags(ticket.tags),
    });
    await this.ticketStore.saveTicket(ticket);

    this.logger.info('Notion import completed', { ticketId, pageId: parsed.pageId });
    this.emitUpdated(ticketId, diff);
  }

  /**
   * Re-arm a failed import: flip the ticket back to pending, broadcast the
   * change so the UI shows "importing" again, and re-run the synthesis in the
   * background. Returns the re-armed (pending) ticket.
   */
  async retry(ticketId: string): Promise<TicketEntity> {
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) {
      throw new TicketNotFoundError(ticketId);
    }

    const link = ticket.links.find((l) => l.type === 'notion_page');
    const parsed = link?.url ? parseNotionUrl(link.url) : null;
    if (!parsed) {
      throw new NotionImportError(
        'Ticket has no retryable Notion page link',
        'NOTION_INVALID_URL',
      );
    }

    const diff = ticket.update({
      title: this.placeholderTitle(),
      description: this.pendingDescription(parsed.url),
      tags: [...this.stripImportTags(ticket.tags), NOTION_IMPORT_PENDING_TAG],
    });
    await this.ticketStore.saveTicket(ticket);
    this.emitUpdated(ticketId, diff);

    this.logger.info('Retrying Notion import', { ticketId, pageId: parsed.pageId });

    void this.completeImport(ticketId, parsed);

    return ticket;
  }

  // ── helpers ──

  private async markFailed(ticketId: string, reason: string, parsed: ParsedNotionUrl): Promise<void> {
    // Re-read here too: the failure path runs after the same slow synthesis, so a concurrent
    // move must be preserved while we flag the ticket failed.
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) {
      this.logger.warn('Notion import target ticket vanished before failure could be recorded', { ticketId });
      return;
    }

    const diff = ticket.update({
      title: 'Notion import failed',
      description: this.failedDescription(reason, parsed.url),
      tags: [...this.stripImportTags(ticket.tags), NOTION_IMPORT_FAILED_TAG],
    });
    await this.ticketStore.saveTicket(ticket);
    this.logger.warn('Notion import failed', { ticketId, reason });
    this.emitUpdated(ticketId, diff);
  }

  private emitUpdated(ticketId: string, changes: Record<string, { from: unknown; to: unknown }>): void {
    this.eventBus?.emit({ type: 'ticket.updated', ticketId, changes, occurredAt: new Date() });
  }

  private placeholderTitle(): string {
    return 'Importing Notion page…';
  }

  private stripImportTags(tags: string[]): string[] {
    return tags.filter((t) => !isNotionImportTag(t));
  }

  private failureReason(result: Exclude<NotionImportResult, { status: 'ok' }>): string {
    switch (result.status) {
      case 'integration_unavailable':
        return "Claude's Notion integration is not available. Connect Notion to Claude and retry.";
      case 'inaccessible':
        return result.detail
          ? `Notion page could not be read: ${result.detail}`
          : 'Notion page could not be read (private page, deleted, or no access).';
      case 'empty':
        return 'Notion page has no content to summarize.';
    }
  }

  private pendingDescription(url: string): string {
    return `_Importing this Notion page — Claude is reading the page and writing a synthesis…_\n\n---\n\n#### Source\n\n- **Notion**: ${url}`;
  }

  private failedDescription(reason: string, url: string): string {
    return `**Notion import failed.** ${reason}\n\nRetry the import once the issue is resolved.\n\n---\n\n#### Source\n\n- **Notion**: ${url}`;
  }

  private buildDescription(synthesis: string, url: string): string {
    return `${synthesis.trim()}\n\n---\n\n#### Source\n\n- **Notion**: ${url}`;
  }
}

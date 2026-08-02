import { randomUUID } from 'node:crypto';

import {
  parseSlackMessageUrl,
  SLACK_IMPORT_PENDING_TAG,
  SLACK_IMPORT_FAILED_TAG,
  isSlackImportTag,
} from '@fleex/shared';
import type { ParsedSlackMessageUrl } from '@fleex/shared';

import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { SlackImportError, TicketNotFoundError } from '../../domain/errors.js';

import type { EventBus } from '../event-bus.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { SlackImportPort, SlackImportResult } from '../ports/slack-import.port.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';

/**
 * Creates a ticket from a pasted Slack message permalink, mirroring the
 * GitHub-issue import flow — but **asynchronously**, because the synthesis
 * (Claude reading the whole thread through the user's native Slack integration)
 * routinely takes far longer than an acceptable request latency.
 *
 * {@link execute} therefore persists a placeholder ticket immediately (tagged
 * {@link SLACK_IMPORT_PENDING_TAG}) and returns it, then drives the slow
 * synthesis in the background via {@link completeImport}. On completion the
 * ticket's title + description are patched and a `ticket.updated` event is
 * emitted so the front swaps in the full ticket DTO — surviving navigation. On
 * failure the ticket is tagged {@link SLACK_IMPORT_FAILED_TAG} so the UI can
 * show the failure and offer {@link retry}. Only the synthesis is ever stored;
 * raw Slack content is never persisted.
 */
export class ImportSlackMessageUseCase {
  /** Wired in the container so background completions can notify the front. */
  public eventBus?: EventBus;

  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly slackImport: SlackImportPort,
    private readonly logger: LoggerPort,
  ) {}

  /**
   * Synchronously create + persist a pending placeholder ticket and kick off the
   * background synthesis. Returns the placeholder so the HTTP layer can respond
   * immediately (201) with a reload-safe ticket.
   */
  async execute(url: string, boardId: string): Promise<TicketEntity> {
    const parsed = parseSlackMessageUrl(url);
    if (!parsed) {
      throw new SlackImportError('Not a valid Slack message link', 'SLACK_INVALID_URL');
    }

    const kind = this.kindOf(parsed);
    const ticketId = randomUUID();
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 0, // assigned by createTicket() below
      title: this.placeholderTitle(kind),
      description: this.pendingDescription(kind, parsed.url),
      status: 'backlog',
      tags: [SLACK_IMPORT_PENDING_TAG],
    });

    ticket.addLink(
      'slack_message',
      `${parsed.channelId}/${parsed.ts}`,
      parsed.threadTs ? 'Slack thread' : 'Slack message',
      parsed.url,
      randomUUID(),
    );

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(
      TicketActivityEntity.create({
        id: randomUUID(),
        ticketId,
        action: 'created',
        changes: { source: { from: null, to: `slack:${parsed.channelId}/${parsed.ts}` } },
        source: 'web',
      }),
    );

    this.logger.info('Slack import placeholder created, synthesizing in background', {
      channelId: parsed.channelId,
      ts: parsed.ts,
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
  async completeImport(ticketId: string, parsed: ParsedSlackMessageUrl): Promise<void> {
    let result: SlackImportResult;
    try {
      result = await this.slackImport.synthesizeThread(parsed);
    } catch (err) {
      this.logger.error('Slack synthesis threw during background import', {
        ticketId,
        error: err instanceof Error ? err.message : String(err),
      });
      await this.markFailed(ticketId, 'Slack synthesis failed unexpectedly.', parsed);
      return;
    }

    if (result.status !== 'ok') {
      await this.markFailed(ticketId, this.failureReason(result), parsed);
      return;
    }

    // Re-read AFTER synthesis so a concurrent move/edit is preserved, not clobbered.
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) {
      this.logger.warn('Slack import target ticket vanished before completion', { ticketId });
      return;
    }

    const diff = ticket.update({
      title: result.title,
      description: this.buildDescription(result.synthesis, parsed.url),
      tags: this.stripImportTags(ticket.tags),
    });
    await this.ticketStore.saveTicket(ticket);

    this.logger.info('Slack import completed', {
      ticketId,
      channelId: parsed.channelId,
      ts: parsed.ts,
    });
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

    const link = ticket.links.find((l) => l.type === 'slack_message');
    const parsed = link?.url ? parseSlackMessageUrl(link.url) : null;
    if (!parsed) {
      throw new SlackImportError('Ticket has no retryable Slack message link', 'SLACK_INVALID_URL');
    }

    const kind = this.kindOf(parsed);
    const diff = ticket.update({
      title: this.placeholderTitle(kind),
      description: this.pendingDescription(kind, parsed.url),
      tags: [...this.stripImportTags(ticket.tags), SLACK_IMPORT_PENDING_TAG],
    });
    await this.ticketStore.saveTicket(ticket);
    this.emitUpdated(ticketId, diff);

    this.logger.info('Retrying Slack import', {
      ticketId,
      channelId: parsed.channelId,
      ts: parsed.ts,
    });

    void this.completeImport(ticketId, parsed);

    return ticket;
  }

  // ── helpers ──

  private async markFailed(
    ticketId: string,
    reason: string,
    parsed: ParsedSlackMessageUrl,
  ): Promise<void> {
    // Re-read here too: the failure path runs after the same slow synthesis, so a concurrent
    // move must be preserved while we flag the ticket failed.
    const ticket = await this.ticketStore.getTicketById(ticketId);
    if (!ticket) {
      this.logger.warn('Slack import target ticket vanished before failure could be recorded', {
        ticketId,
      });
      return;
    }

    const diff = ticket.update({
      title: 'Slack import failed',
      description: this.failedDescription(reason, parsed.url),
      tags: [...this.stripImportTags(ticket.tags), SLACK_IMPORT_FAILED_TAG],
    });
    await this.ticketStore.saveTicket(ticket);
    this.logger.warn('Slack import failed', { ticketId, reason });
    this.emitUpdated(ticketId, diff);
  }

  private emitUpdated(
    ticketId: string,
    changes: Record<string, { from: unknown; to: unknown }>,
  ): void {
    this.eventBus?.emit({ type: 'ticket.updated', ticketId, changes, occurredAt: new Date() });
  }

  private kindOf(parsed: ParsedSlackMessageUrl): 'thread' | 'message' {
    return parsed.threadTs ? 'thread' : 'message';
  }

  private placeholderTitle(kind: 'thread' | 'message'): string {
    return `Importing Slack ${kind}…`;
  }

  private stripImportTags(tags: string[]): string[] {
    return tags.filter((t) => !isSlackImportTag(t));
  }

  private failureReason(result: Exclude<SlackImportResult, { status: 'ok' }>): string {
    switch (result.status) {
      case 'integration_unavailable':
        return "Claude's Slack integration is not available. Connect Slack to Claude and retry.";
      case 'inaccessible':
        return result.detail
          ? `Slack conversation could not be read: ${result.detail}`
          : 'Slack conversation could not be read (private channel, deleted message, or no access).';
      case 'empty':
        return 'Slack conversation has no content to summarize.';
    }
  }

  private pendingDescription(kind: 'thread' | 'message', url: string): string {
    return `_Importing this Slack ${kind} — Claude is reading the conversation and writing a synthesis…_\n\n---\n\n#### Source\n\n- **Slack**: ${url}`;
  }

  private failedDescription(reason: string, url: string): string {
    return `**Slack import failed.** ${reason}\n\nRetry the import once the issue is resolved.\n\n---\n\n#### Source\n\n- **Slack**: ${url}`;
  }

  private buildDescription(synthesis: string, url: string): string {
    return `${synthesis.trim()}\n\n---\n\n#### Source\n\n- **Slack**: ${url}`;
  }
}

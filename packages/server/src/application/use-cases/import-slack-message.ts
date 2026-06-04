import { randomUUID } from 'node:crypto';
import { parseSlackMessageUrl } from '@fleex/shared';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { SlackImportError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { SlackImportPort } from '../ports/slack-import.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Creates a ticket from a pasted Slack message permalink, mirroring the
 * GitHub-issue import flow. The message (and its thread, when applicable) is
 * retrieved and synthesized by Claude through the user's native Slack
 * integration; only the synthesis is stored as the ticket description.
 *
 * Failure modes map to {@link SlackImportError} codes so the HTTP layer can
 * return an actionable 422.
 */
export class ImportSlackMessageUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly slackImport: SlackImportPort,
    private readonly logger: LoggerPort,
  ) {}

  async execute(url: string, boardId: string): Promise<TicketEntity> {
    const parsed = parseSlackMessageUrl(url);
    if (!parsed) {
      throw new SlackImportError(
        'Not a valid Slack message link',
        'SLACK_INVALID_URL',
      );
    }

    this.logger.info('Importing Slack message as ticket', {
      channelId: parsed.channelId,
      ts: parsed.ts,
      threaded: parsed.threadTs !== null,
    });

    const result = await this.slackImport.synthesizeThread(parsed);

    switch (result.status) {
      case 'integration_unavailable':
        throw new SlackImportError(
          "Claude's Slack integration is not available. Connect Slack to Claude and try again.",
          'SLACK_INTEGRATION_UNAVAILABLE',
        );
      case 'inaccessible':
        throw new SlackImportError(
          result.detail
            ? `Slack conversation could not be read: ${result.detail}`
            : 'Slack conversation could not be read (private channel, deleted message, or no access).',
          'SLACK_CONVERSATION_INACCESSIBLE',
        );
      case 'empty':
        throw new SlackImportError(
          'Slack conversation has no content to summarize.',
          'SLACK_CONVERSATION_EMPTY',
        );
      case 'ok':
        break;
    }

    const description = this.buildDescription(result.synthesis, parsed.url);

    const ticketId = randomUUID();
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 0, // assigned by createTicket() below
      title: result.title,
      description,
      status: 'backlog',
      tags: [],
    });

    ticket.addLink(
      'slack_message',
      `${parsed.channelId}/${parsed.ts}`,
      parsed.threadTs ? 'Slack thread' : 'Slack message',
      parsed.url,
      randomUUID(),
    );

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action: 'created',
      changes: { source: { from: null, to: `slack:${parsed.channelId}/${parsed.ts}` } },
      source: 'web',
    }));

    this.logger.info('Slack message imported as ticket', {
      channelId: parsed.channelId,
      ts: parsed.ts,
      ticketId,
    });

    return ticket;
  }

  private buildDescription(synthesis: string, url: string): string {
    return `${synthesis.trim()}\n\n---\n\n#### Source\n\n- **Slack**: ${url}`;
  }
}

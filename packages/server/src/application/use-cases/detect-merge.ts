import { randomUUID } from 'node:crypto';
import { EVENT_TYPES } from '@asm/shared';
import type { PullRequest } from '@asm/shared';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { createEvent } from '../../domain/events/create-event.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBusPort } from '../ports/event-bus.port.js';

export class DetectMergeUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
    private readonly eventBus?: EventBusPort,
  ) {}

  async execute(mergedPRs: PullRequest[], repoKey: string): Promise<string[]> {
    const movedTicketIds: string[] = [];

    for (const pr of mergedPRs) {
      // Find tickets linked to this PR's branch via worktree link
      const byWorktree = (await this.ticketStore.getTicketsLinkedTo('worktree', '')).filter((t) =>
        t.links.some(
          (l) => l.type === 'worktree' && l.ref.includes(pr.headRefName),
        ),
      );

      // Find tickets with github_pr link matching PR number
      const byPR = await this.ticketStore.getTicketsLinkedTo(
        'github_pr',
        `${repoKey}#${pr.number}`,
      );

      const allMatches = new Map<string, typeof byWorktree[0]>();
      for (const t of [...byWorktree, ...byPR]) {
        allMatches.set(t.id, t);
      }

      for (const ticket of allMatches.values()) {
        if (ticket.status === 'done') continue;

        const diff = ticket.moveTo('done');
        if (Object.keys(diff).length === 0) continue;

        // Add github_pr link if not already present
        const hasPRLink = ticket.links.some(
          (l) => l.type === 'github_pr' && l.ref === `${repoKey}#${pr.number}`,
        );
        if (!hasPRLink) {
          ticket.addLink(
            'github_pr',
            `${repoKey}#${pr.number}`,
            `PR #${pr.number}`,
            `https://github.com/${repoKey}/pull/${pr.number}`,
            randomUUID(),
          );
        }

        await this.ticketStore.saveTicket(ticket);
        await this.ticketStore.saveActivity(TicketActivityEntity.create({
          id: randomUUID(),
          ticketId: ticket.id,
          action: 'moved',
          changes: diff,
          source: 'api',
          actorName: 'merge-detector',
        }));

        movedTicketIds.push(ticket.id);
        this.logger.info('Ticket auto-moved to done via merge', {
          ticketId: ticket.id,
          prNumber: pr.number,
          repoKey,
        });

        this.eventBus?.emit(createEvent(EVENT_TYPES.TICKET_MOVED, {
          ticket: ticket.toDTO(),
          changes: diff,
        }, { source: 'scheduler', actor: 'merge-detector' }));
      }
    }

    if (movedTicketIds.length > 0) {
      this.eventBus?.emit(createEvent(EVENT_TYPES.REPOSITORY_MERGE_DETECTED, {
        repoKey,
        mergedPRCount: mergedPRs.length,
        movedTicketIds,
      }, { source: 'scheduler' }));
    }

    return movedTicketIds;
  }
}

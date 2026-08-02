import { randomUUID } from 'node:crypto';
import type { PullRequest } from '@fleex/shared';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { EventBus } from '../event-bus.js';

/**
 * Auto-close tickets whose PR just got merged.
 *
 * Emits `ticket.moved` itself: the auto-resolution of the ticket's mentions
 * hangs off that event via DomainEventListener → AutoReviewWorkflow. Wiring it
 * from the caller instead meant the real `fromStatus` was lost (it was persisted
 * as `''` in the audit log) and nothing prevented the emission from being
 * dropped. Keep it here, and keep it covered by tests.
 */
export class DetectMergeUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
    private readonly eventBus: EventBus,
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
        if (ticket.status === 'done' || ticket.status === 'cancelled') continue;

        // Captured before moveTo() mutates it — the event carries the real
        // origin status, not a placeholder.
        const fromStatus = ticket.status;
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

        // Link first: moving to done triggers mention auto-resolution and
        // summary generation, and the PR link should already be in the trail
        // by the time those run.
        if (!hasPRLink) {
          this.eventBus.emit({
            type: 'ticket.linkAdded',
            ticketId: ticket.id,
            linkType: 'github_pr',
            ref: `${repoKey}#${pr.number}`,
            label: `PR #${pr.number}`,
            occurredAt: new Date(),
          });
        }

        this.eventBus.emit({
          type: 'ticket.moved',
          ticketId: ticket.id,
          fromStatus,
          toStatus: 'done',
          source: 'merge-detector',
          occurredAt: new Date(),
        });

        movedTicketIds.push(ticket.id);
        this.logger.info('Ticket auto-moved to done via merge', {
          ticketId: ticket.id,
          prNumber: pr.number,
          repoKey,
        });
      }
    }

    return movedTicketIds;
  }
}

import { randomUUID } from 'node:crypto';
import { githubPrSource } from '@fleex/shared';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ImportSourceAdapter } from '../ports/import-source.port.js';

interface BackfillPRTicketParams {
  org: string;
  name: string;
  prNumber: number;
  prTitle: string;
  headRefName: string;
  prUrl: string;
  boardId: string;
  role: 'author' | 'reviewer';
}

export class BackfillPRTicketUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
    /** The github_pr import adapter — used best-effort to enrich the body. */
    private readonly prAdapter: ImportSourceAdapter,
  ) {}

  async execute(params: BackfillPRTicketParams): Promise<TicketEntity> {
    const { org, name, prNumber, prTitle, headRefName, prUrl, boardId, role } = params;

    const ticketId = randomUUID();
    // The PR ref goes through the shared source so it is lowercased consistently
    // with the new import flow (the ticket's hard constraint).
    const match = githubPrSource.fromParts(org, name, prNumber);

    // Best-effort enrichment: pull the PR's body so a "test this PR" ticket isn't
    // empty. A GitHub failure must NEVER break an import that used to succeed with
    // only the title — so we log and fall back to the title-only body.
    let description: string | undefined;
    try {
      const resolved = await this.prAdapter.resolve(match);
      description = resolved.description;
    } catch (err) {
      this.logger.warn('PR backfill could not fetch the PR body; creating with title only', {
        org, name, prNumber, error: err instanceof Error ? err.message : String(err),
      });
    }

    const status = role === 'reviewer' ? 'reviewing' : 'doing';

    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 0, // assigned by createTicket() below
      title: prTitle,
      description,
      status,
    });

    // Link to the GitHub PR (lowercased ref via the shared source).
    ticket.addLink('github_pr', match.ref, `#${prNumber}`, prUrl, randomUUID());

    // Link to worktree (branch)
    ticket.addLink('worktree', `${org}/${name}:${headRefName}`, headRefName, null, randomUUID());

    // Link to repository
    ticket.addLink('repository', `${org}/${name}`, `${org}/${name}`, null, randomUUID());

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(TicketActivityEntity.create({
      id: randomUUID(),
      ticketId,
      action: 'created',
      changes: { source: { from: null, to: `pr-backfill:${org}/${name}#${prNumber}` } },
      source: 'web',
    }));

    this.logger.info('PR backfilled as ticket', { org, name, prNumber, ticketId, role });

    return ticket;
  }
}

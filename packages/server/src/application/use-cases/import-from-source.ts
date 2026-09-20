import { randomUUID } from 'node:crypto';
import {
  detectSource,
  type ImportExistingTicket,
  type ImportPreview,
  type SourceMatch,
  type TicketStatus,
  type TicketType,
} from '@fleex/shared';
import { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import { ImportError } from '../../domain/errors.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ImportSourceRegistry } from '../services/import-sources/registry.js';

/**
 * The single entry point for importing a task from an external source. It owns
 * the two halves of the flow:
 *  - {@link preview} resolves a pasted input into a draft WITHOUT touching the
 *    database (the new-task flow prefills the composer from it), and reports any
 *    tickets already linked to the same source (non-blocking).
 *  - {@link import} resolves AND creates the ticket by the normal path (used by
 *    the legacy aliases, the CLI and agents).
 *
 * It never knows a source's specifics — those live behind the registry's adapters.
 */
export class ImportFromSourceUseCase {
  constructor(
    private readonly registry: ImportSourceRegistry,
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
  ) {}

  /** Detect a source from raw input, or fail with IMPORT_INVALID_INPUT. */
  detect(input: string): SourceMatch {
    const match = detectSource(input);
    if (!match) {
      throw new ImportError("That link isn't a source Fleex can import.", 'IMPORT_INVALID_INPUT');
    }
    return match;
  }

  /** Resolve a source into a preview. Creates nothing, writes nothing. */
  async preview(input: string, opts?: { signal?: AbortSignal }): Promise<ImportPreview> {
    const match = this.detect(input);
    const adapter = this.registry.get(match.sourceId);
    if (!adapter) {
      throw new ImportError(`No importer available for ${match.sourceId}.`, 'IMPORT_SOURCE_UNAVAILABLE', match.sourceId);
    }

    const resolved = await adapter.resolve(match, opts);
    const existingTickets = await this.findExisting(match);

    return {
      ...resolved,
      sourceId: match.sourceId,
      ref: match.ref,
      url: match.url,
      label: match.label,
      existingTickets,
    };
  }

  /**
   * Resolve a match and create the ticket by the normal path (links from the
   * resolved import + a repository link when the source carries a repo + issue
   * metadata). Status defaults to `backlog`. Emission of `ticket.created` is left
   * to the HTTP layer, matching the existing import routes.
   */
  async import(
    match: SourceMatch,
    boardId: string,
    opts?: { status?: TicketStatus; type?: TicketType },
  ): Promise<TicketEntity> {
    const adapter = this.registry.get(match.sourceId);
    if (!adapter) {
      throw new ImportError(`No importer available for ${match.sourceId}.`, 'IMPORT_SOURCE_UNAVAILABLE', match.sourceId);
    }

    const resolved = await adapter.resolve(match);

    const ticketId = randomUUID();
    const ticket = TicketEntity.create({
      id: ticketId,
      boardId,
      displayId: 0, // assigned by createTicket() below
      title: resolved.title,
      description: resolved.description,
      status: opts?.status ?? 'backlog',
      type: opts?.type ?? resolved.suggested?.type ?? null,
      tags: resolved.tags,
    });

    for (const link of resolved.links) {
      ticket.addLink(link.type, link.ref, link.label, link.url, randomUUID(), link.baseBranch);
    }
    if (resolved.repo) {
      const key = `${resolved.repo.org}/${resolved.repo.name}`;
      ticket.addLink('repository', key, key, null, randomUUID());
    }
    if (resolved.githubMetadata) {
      ticket.setGithubMetadata(resolved.githubMetadata);
    }

    await this.ticketStore.createTicket(ticket);
    await this.ticketStore.saveActivity(
      TicketActivityEntity.create({
        id: randomUUID(),
        ticketId,
        action: 'created',
        changes: { source: { from: null, to: `${match.sourceId}:${match.ref}` } },
        source: 'web',
      }),
    );

    this.logger.info('Task imported from source', { sourceId: match.sourceId, ref: match.ref, ticketId });
    return ticket;
  }

  /**
   * Tickets already linked to this source. For a PR the ref is lowercased, but
   * historical links (backfill) preserved GitHub's casing — so query both the
   * lowercased ref and the original-casing one and dedup by id.
   */
  private async findExisting(match: SourceMatch): Promise<ImportExistingTicket[]> {
    const refs = new Set<string>([match.ref]);
    if (match.sourceId === 'github_pr') {
      refs.add(`${String(match.params['org'])}/${String(match.params['name'])}#${Number(match.params['number'])}`);
    }

    const lists = await Promise.all(
      [...refs].map((ref) => this.ticketStore.getTicketsLinkedTo(match.sourceId, ref)),
    );
    const byId = new Map(lists.flat().map((t) => [t.id, t]));

    return [...byId.values()].map((t) => ({
      id: t.id,
      displayId: t.displayId,
      title: t.title,
      status: t.status,
      archived: t.archivedAt != null,
    }));
  }
}

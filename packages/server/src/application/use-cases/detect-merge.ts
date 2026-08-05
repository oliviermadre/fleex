import { randomUUID } from 'node:crypto';
import type { PullRequest, TicketStatus } from '@fleex/shared';
import { TicketActivityEntity } from '../../domain/entities/ticket-activity.entity.js';
import type { TicketEntity } from '../../domain/entities/ticket.entity.js';
import { parsePRRef, type ParsedPRRef } from '../../domain/services/pr-ref.js';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { LoggerPort } from '../ports/logger.port.js';

/**
 * Fetches live PR states, keyed by `"org/name#number"` → `"OPEN" | "MERGED" | "CLOSED"`.
 * Backed by `GitHubGraphQLAdapter.fetchPRStates`; a failed lookup yields a partial
 * (possibly empty) map rather than throwing.
 */
export type FetchPRStatesFn = (prs: ParsedPRRef[]) => Promise<Map<string, string>>;

export interface MergeDetectionResult {
  id: string;
  fromStatus: TicketStatus;
}

interface Candidate {
  ticket: TicketEntity;
  /** Refs this batch proved merged — authoritative even if the state lookup fails. */
  mergedRefs: Set<string>;
}

export class DetectMergeUseCase {
  constructor(
    private readonly ticketStore: TicketStorePort,
    private readonly logger: LoggerPort,
    private readonly fetchPRStates: FetchPRStatesFn,
  ) {}

  async execute(mergedPRs: PullRequest[], repoKey: string): Promise<MergeDetectionResult[]> {
    const candidates = await this.collectCandidates(mergedPRs, repoKey);
    if (candidates.size === 0) return [];

    // A ticket is only done once EVERY one of its PRs is resolved, so we need the
    // live state of the PRs this batch says nothing about — including PRs living
    // in other repositories (a ticket can span several worktrees/repos).
    const states = await this.resolveStates(candidates);

    const moved: MergeDetectionResult[] = [];

    for (const { ticket, mergedRefs } of candidates.values()) {
      const refs = this.prRefsOf(ticket, mergedRefs);
      const verdict = this.verdict(refs, mergedRefs, states);

      if (!verdict.complete) {
        this.logger.info('Ticket held back from done — not all PRs are resolved', {
          ticketId: ticket.id,
          openRefs: verdict.openRefs,
          unknownRefs: verdict.unknownRefs,
          hasMerge: verdict.hasMerge,
        });
        continue;
      }

      const fromStatus = ticket.status;
      const diff = ticket.moveTo('done');
      if (Object.keys(diff).length === 0) continue;

      await this.ticketStore.saveTicket(ticket);
      await this.ticketStore.saveActivity(TicketActivityEntity.create({
        id: randomUUID(),
        ticketId: ticket.id,
        action: 'moved',
        changes: diff,
        source: 'api',
        actorName: 'merge-detector',
      }));

      moved.push({ id: ticket.id, fromStatus });
      this.logger.info('Ticket auto-moved to done — all PRs resolved', {
        ticketId: ticket.id,
        prRefs: refs,
        repoKey,
      });
    }

    return moved;
  }

  /**
   * Tickets linked to one of the PRs this batch reports as merged. Matching is by
   * `github_pr` link only — a worktree with no PR never blocks nor triggers a move.
   */
  private async collectCandidates(
    mergedPRs: PullRequest[],
    repoKey: string,
  ): Promise<Map<string, Candidate>> {
    const candidates = new Map<string, Candidate>();

    for (const pr of mergedPRs) {
      const ref = `${repoKey}#${pr.number}`;
      const tickets = await this.ticketStore.getTicketsLinkedTo('github_pr', ref);

      for (const ticket of tickets) {
        if (ticket.status === 'done' || ticket.status === 'cancelled') continue;
        const existing = candidates.get(ticket.id);
        if (existing) {
          existing.mergedRefs.add(ref);
        } else {
          candidates.set(ticket.id, { ticket, mergedRefs: new Set([ref]) });
        }
      }
    }

    return candidates;
  }

  /** One batched GitHub call for every PR we don't already know the state of. */
  private async resolveStates(candidates: Map<string, Candidate>): Promise<Map<string, string>> {
    const toFetch = new Map<string, ParsedPRRef>();

    for (const { ticket, mergedRefs } of candidates.values()) {
      for (const ref of this.prRefsOf(ticket, mergedRefs)) {
        if (mergedRefs.has(ref) || toFetch.has(ref)) continue;
        const parsed = parsePRRef(ref);
        if (parsed) toFetch.set(ref, parsed);
      }
    }

    if (toFetch.size === 0) return new Map();
    return this.fetchPRStates([...toFetch.values()]);
  }

  private prRefsOf(ticket: TicketEntity, mergedRefs: Set<string>): string[] {
    const refs = new Set(mergedRefs);
    for (const link of ticket.links) {
      if (link.type === 'github_pr') refs.add(link.ref);
    }
    return [...refs];
  }

  /**
   * Done requires every PR resolved (merged or closed) AND at least one merge —
   * a ticket whose PRs were all abandoned isn't finished work. An unknown state
   * blocks too: `fetchPRStates` swallows its errors, so "no answer" must never
   * read as "resolved".
   */
  private verdict(
    refs: string[],
    mergedRefs: Set<string>,
    states: Map<string, string>,
  ): { complete: boolean; hasMerge: boolean; openRefs: string[]; unknownRefs: string[] } {
    const openRefs: string[] = [];
    const unknownRefs: string[] = [];
    let hasMerge = false;

    for (const ref of refs) {
      const state = mergedRefs.has(ref) ? 'MERGED' : states.get(ref);
      if (state === 'MERGED') hasMerge = true;
      else if (state === 'CLOSED') continue;
      else if (state === 'OPEN') openRefs.push(ref);
      else unknownRefs.push(ref);
    }

    return {
      complete: hasMerge && openRefs.length === 0 && unknownRefs.length === 0,
      hasMerge,
      openRefs,
      unknownRefs,
    };
  }
}

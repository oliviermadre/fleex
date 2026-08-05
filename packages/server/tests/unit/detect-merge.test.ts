import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PullRequest } from '@fleex/shared';
import { DetectMergeUseCase } from '../../src/application/use-cases/detect-merge.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} } as never;

/** A ticket in `doing` carrying one `github_pr` link per ref. */
function ticketWithPRs(id: string, refs: string[]): TicketEntity {
  const ticket = TicketEntity.create({ id, boardId: 'b1', displayId: 1, title: id, status: 'doing' });
  for (const ref of refs) ticket.addLink('github_pr', ref, ref, null, randomUUID());
  return ticket;
}

function mergedPR(number: number): PullRequest {
  return { number, title: `PR ${number}`, headRefName: `branch-${number}`, state: 'merged' } as PullRequest;
}

function setup(tickets: TicketEntity[], states: Record<string, string>) {
  const activities: { ticketId: string; action: string; actorName?: string | null }[] = [];
  const saved: string[] = [];
  let fetched: { org: string; name: string; number: number }[] = [];

  const store = {
    getTicketsLinkedTo: async (type: string, ref: string) =>
      tickets.filter((t) => t.links.some((l) => l.type === type && l.ref === ref)),
    saveTicket: async (t: TicketEntity) => { saved.push(t.id); },
    saveActivity: async (a: { ticketId: string; action: string }) => { activities.push(a); },
  } as never;

  const useCase = new DetectMergeUseCase(store, logger, async (prs) => {
    fetched = prs;
    const map = new Map<string, string>();
    for (const pr of prs) {
      const state = states[`${pr.org}/${pr.name}#${pr.number}`];
      if (state) map.set(`${pr.org}/${pr.name}#${pr.number}`, state);
    }
    return map;
  });

  return { useCase, activities, saved, fetchedRefs: () => fetched };
}

describe('DetectMergeUseCase', () => {
  it('holds a multi-repo ticket back while one of its PRs is still open', async () => {
    const ticket = ticketWithPRs('t1', ['acme/api#1', 'acme/web#2']);
    const { useCase, activities, saved } = setup([ticket], { 'acme/web#2': 'OPEN' });

    const moved = await useCase.execute([mergedPR(1)], 'acme/api');

    expect(moved).toEqual([]);
    expect(ticket.status).toBe('doing');
    expect(activities).toEqual([]);
    expect(saved).toEqual([]);
  });

  it('moves the ticket to done once the last open PR is merged too', async () => {
    const ticket = ticketWithPRs('t1', ['acme/api#1', 'acme/web#2']);
    const { useCase, activities } = setup([ticket], { 'acme/web#2': 'MERGED' });

    const moved = await useCase.execute([mergedPR(1)], 'acme/api');

    expect(moved).toEqual([{ id: 't1', fromStatus: 'doing' }]);
    expect(ticket.status).toBe('done');
    expect(activities).toMatchObject([{ ticketId: 't1', action: 'moved', actorName: 'merge-detector' }]);
  });

  it('treats a closed PR as resolved when another one was merged', async () => {
    const ticket = ticketWithPRs('t1', ['acme/api#1', 'acme/web#2']);
    const { useCase } = setup([ticket], { 'acme/web#2': 'CLOSED' });

    const moved = await useCase.execute([mergedPR(1)], 'acme/api');

    expect(moved).toHaveLength(1);
    expect(ticket.status).toBe('done');
  });

  it('still moves a single-PR ticket to done (nominal case)', async () => {
    const ticket = ticketWithPRs('t1', ['acme/api#1']);
    const { useCase, fetchedRefs } = setup([ticket], {});

    const moved = await useCase.execute([mergedPR(1)], 'acme/api');

    expect(moved).toHaveLength(1);
    expect(ticket.status).toBe('done');
    // The merged PR is authoritative locally — no GitHub round-trip needed.
    expect(fetchedRefs()).toEqual([]);
  });

  it('does not move a ticket when the state lookup comes back empty', async () => {
    const ticket = ticketWithPRs('t1', ['acme/api#1', 'acme/web#2']);
    const { useCase } = setup([ticket], {});

    const moved = await useCase.execute([mergedPR(1)], 'acme/api');

    expect(moved).toEqual([]);
    expect(ticket.status).toBe('doing');
  });

  it('batches every unknown PR of every candidate into a single lookup', async () => {
    const t1 = ticketWithPRs('t1', ['acme/api#1', 'acme/web#2']);
    const t2 = ticketWithPRs('t2', ['acme/api#3', 'acme/infra#4']);
    const { useCase, fetchedRefs } = setup([t1, t2], { 'acme/web#2': 'OPEN', 'acme/infra#4': 'OPEN' });

    await useCase.execute([mergedPR(1), mergedPR(3)], 'acme/api');

    expect(fetchedRefs()).toEqual([
      { org: 'acme', name: 'web', number: 2 },
      { org: 'acme', name: 'infra', number: 4 },
    ]);
  });

  it('ignores tickets already done or cancelled', async () => {
    const ticket = ticketWithPRs('t1', ['acme/api#1']);
    ticket.moveTo('cancelled');
    const { useCase } = setup([ticket], {});

    expect(await useCase.execute([mergedPR(1)], 'acme/api')).toEqual([]);
    expect(ticket.status).toBe('cancelled');
  });
});

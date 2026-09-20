import { describe, it, expect } from 'vitest';
import type { TicketLink } from '@fleex/shared';
import { extractRepoPrNumber, resolveWorktreeTarget } from '../../src/domain/services/branch-utils.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';

const repoLink = (ref: string, extra: Partial<TicketLink> = {}): TicketLink => ({
  id: ref, type: 'repository', ref, label: ref, url: null, createdAt: 'now', ...extra,
});
const prLink = (ref: string): TicketLink => ({
  id: ref, type: 'github_pr', ref, label: '#', url: null, createdAt: 'now',
});

describe('resolveWorktreeTarget', () => {
  const TICKET_BRANCH = 'ticket/abc123-x';

  it('rule 1 — checkoutRef checks out that branch directly, with the PR number for a fork', () => {
    const links = [repoLink('evaneos/fleex', { checkoutRef: 'feat/import' }), prLink('evaneos/fleex#7')];
    expect(resolveWorktreeTarget(links, 'evaneos', 'fleex', TICKET_BRANCH, 'feat/import')).toEqual({
      branch: 'feat/import',
      createNewBranch: false,
      prNumber: 7,
    });
  });

  it('rule 2 — baseBranch branches a fresh ticket branch on top, even when a PR link exists', () => {
    const links = [repoLink('evaneos/fleex', { baseBranch: 'feat/import' }), prLink('evaneos/fleex#7')];
    expect(resolveWorktreeTarget(links, 'evaneos', 'fleex', TICKET_BRANCH, 'feat/import')).toEqual({
      branch: TICKET_BRANCH,
      createNewBranch: true,
      baseBranch: 'origin/feat/import',
    });
  });

  it('rule 3 — a bare PR link checks out the PR head (legacy behaviour, non-regression)', () => {
    const links = [repoLink('evaneos/fleex'), prLink('evaneos/fleex#7')];
    expect(resolveWorktreeTarget(links, 'evaneos', 'fleex', TICKET_BRANCH, 'feat/import')).toEqual({
      branch: 'feat/import',
      createNewBranch: false,
    });
  });

  it('rule 3 — matches a PR link stored in a different case than the repo ref', () => {
    const links = [repoLink('Evaneos/Fleex'), prLink('evaneos/fleex#7')];
    const target = resolveWorktreeTarget(links, 'Evaneos', 'Fleex', TICKET_BRANCH, 'feat/import');
    expect(target).toEqual({ branch: 'feat/import', createNewBranch: false });
  });

  it('rule 4 — no PR head and no custom base mints the ticket branch from the default', () => {
    const links = [repoLink('evaneos/fleex')];
    expect(resolveWorktreeTarget(links, 'evaneos', 'fleex', TICKET_BRANCH)).toEqual({
      branch: TICKET_BRANCH,
      createNewBranch: true,
    });
  });

  it('rule 4 — a PR link without a fetched head falls through to the ticket branch', () => {
    const links = [repoLink('evaneos/fleex'), prLink('evaneos/fleex#7')];
    expect(resolveWorktreeTarget(links, 'evaneos', 'fleex', TICKET_BRANCH)).toEqual({
      branch: TICKET_BRANCH,
      createNewBranch: true,
    });
  });
});

describe('extractRepoPrNumber', () => {
  it('reads the PR number from the repo\'s github_pr link, case-insensitively', () => {
    const links = [repoLink('Evaneos/Fleex'), prLink('evaneos/fleex#42')];
    expect(extractRepoPrNumber(links, 'Evaneos', 'Fleex')).toBe(42);
  });

  it('returns undefined when the repo has no PR link', () => {
    expect(extractRepoPrNumber([repoLink('evaneos/fleex')], 'evaneos', 'fleex')).toBeUndefined();
  });

  it('does not confuse another repo\'s PR link', () => {
    const links = [repoLink('evaneos/fleex'), prLink('acme/web#7')];
    expect(extractRepoPrNumber(links, 'evaneos', 'fleex')).toBeUndefined();
  });
});

describe('TicketEntity — checkoutRef on repository links', () => {
  const newTicket = () => TicketEntity.create({ id: 't', boardId: 'b', displayId: 1, title: 'T' });

  it('stores checkoutRef only on repository links', () => {
    const t = newTicket();
    const repo = t.addLink('repository', 'o/n', 'n', null, 'l1', undefined, 'feat/x');
    expect(repo.checkoutRef).toBe('feat/x');
    expect(repo.baseBranch).toBeUndefined();

    const pr = t.addLink('github_pr', 'o/n#1', '#1', null, 'l2', undefined, 'feat/x');
    expect(pr.checkoutRef).toBeUndefined();
  });

  it('checkoutRef wins over baseBranch when both are somehow passed (they are exclusive)', () => {
    const t = newTicket();
    const repo = t.addLink('repository', 'o/n', 'n', null, 'l1', 'base/x', 'checkout/y');
    expect(repo.checkoutRef).toBe('checkout/y');
    expect(repo.baseBranch).toBeUndefined();
  });
});

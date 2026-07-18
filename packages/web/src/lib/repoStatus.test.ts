import { describe, it, expect } from 'vitest';
import type { Ticket, TicketLink } from '@fleex/shared';
import {
  NO_REPO_TAG,
  ticketHasRepo,
  isRepoOptional,
  isMissingRepo,
  mentionsPrimitive,
  topReposForBoard,
} from './repoStatus';

function link(overrides: Partial<TicketLink> & Pick<TicketLink, 'type' | 'ref'>): TicketLink {
  return {
    id: `${overrides.type}:${overrides.ref}`,
    label: overrides.ref,
    url: null,
    createdAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    boardId: 'b1',
    displayId: 1,
    title: 'A ticket',
    description: '',
    status: 'doing',
    priority: 'none',
    type: null,
    position: 0,
    tags: [],
    links: [],
    blocked: false,
    favorite: false,
    dueDate: null,
    assignee: null,
    agentClaimedAt: null,
    githubMetadata: null,
    archivedAt: null,
    firstDoingAt: null,
    statusChangedAt: '2026-07-01T00:00:00.000Z',
    conversationMode: 'plan',
    modelOverride: null,
    effortOverride: null,
    fastMode: false,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ticketHasRepo', () => {
  // WHY: "sans repo" is defined by the spec as the ABSENCE of a `repository`
  // link — that link is what makes ensureWorkspace() build a worktree. A
  // worktree link alone (or any other link type) must NOT count as "has repo",
  // otherwise the guard-rail would stay silent on a ticket that can't run code.
  it('is true only when a repository link is present', () => {
    expect(ticketHasRepo(makeTicket({ links: [link({ type: 'repository', ref: 'org/a' })] }))).toBe(true);
  });

  it('is false with no links at all', () => {
    expect(ticketHasRepo(makeTicket({ links: [] }))).toBe(false);
  });

  it('is false when only non-repository links exist (e.g. worktree, issue)', () => {
    expect(
      ticketHasRepo(
        makeTicket({
          links: [link({ type: 'worktree', ref: 'org/a:branch' }), link({ type: 'github_issue', ref: 'org/a#1' })],
        }),
      ),
    ).toBe(false);
  });
});

describe('isRepoOptional', () => {
  it('is true when the no-repo tag is present', () => {
    expect(isRepoOptional(makeTicket({ tags: [NO_REPO_TAG] }))).toBe(true);
  });

  it('is false when the tag is absent', () => {
    expect(isRepoOptional(makeTicket({ tags: ['urgent'] }))).toBe(false);
  });
});

describe('isMissingRepo', () => {
  // WHY: this is the single predicate every surface (badge, banner, filter,
  // guard-rail) keys off. It must be true ONLY for the forgotten case — a
  // ticket that should have a repo but doesn't — and never for a deliberate
  // "no-code" ticket, so the flag can silence the warning as the spec intends.
  it('is true for a ticket with no repo and no no-repo tag (the forgotten case)', () => {
    expect(isMissingRepo(makeTicket({ links: [], tags: [] }))).toBe(true);
  });

  it('is false when a repository link exists', () => {
    expect(isMissingRepo(makeTicket({ links: [link({ type: 'repository', ref: 'org/a' })] }))).toBe(false);
  });

  it('is false when the ticket is explicitly flagged no-repo (deliberate no-code)', () => {
    expect(isMissingRepo(makeTicket({ links: [], tags: [NO_REPO_TAG] }))).toBe(false);
  });
});

describe('mentionsPrimitive', () => {
  // WHY: the guard-rail must fire for ANY primitive that spins up a run needing
  // a worktree — agent, skill, workflow, panel — not just @agent. Missing one
  // type would let a degraded "no codebase" run start silently.
  it.each([
    ['@agent:builder go', true],
    ['@skill:foo please', true],
    ['@workflow:spec-dev-qa', true],
    ['@panel:review team', true],
    ['plain comment, no mention', false],
    ['email me at foo@bar.com', false],
    ['@human can you look?', false],
  ])('detects a primitive mention in %j → %s', (body, expected) => {
    expect(mentionsPrimitive(body as string)).toBe(expected);
  });

  it('ignores struck-through (cancelled) mentions, mirroring the server parser', () => {
    expect(mentionsPrimitive('~~@agent:builder~~ never mind')).toBe(false);
  });
});

describe('topReposForBoard', () => {
  // WHY: the suggestion must rank by RECENCY-WEIGHTED usage on THIS board so the
  // 1-click default is the repo you've been working with lately — not the one
  // you used most long ago. Ties break alphabetically so the order is
  // deterministic (no flicker between renders).
  //
  // These first cases share one link date, so decay is uniform and ranking
  // reduces to raw count — the classic frequency behaviour, still guaranteed.
  const tickets: Ticket[] = [
    makeTicket({ id: '1', boardId: 'b1', links: [link({ type: 'repository', ref: 'org/a' })] }),
    makeTicket({ id: '2', boardId: 'b1', links: [link({ type: 'repository', ref: 'org/a' })] }),
    makeTicket({ id: '3', boardId: 'b1', links: [link({ type: 'repository', ref: 'org/b' })] }),
    makeTicket({ id: '4', boardId: 'b1', links: [link({ type: 'repository', ref: 'org/c' })] }),
    // Different board — must not leak into b1's ranking.
    makeTicket({ id: '5', boardId: 'b2', links: [link({ type: 'repository', ref: 'org/z' })] }),
    makeTicket({ id: '6', boardId: 'b1', links: [] }),
  ];

  it('ranks repos of the board by descending usage, ties broken alphabetically', () => {
    expect(topReposForBoard(tickets, 'b1')).toEqual(['org/a', 'org/b', 'org/c']);
  });

  it('honours the limit', () => {
    expect(topReposForBoard(tickets, 'b1', { limit: 1 })).toEqual(['org/a']);
  });

  it('excludes already-linked repos', () => {
    expect(topReposForBoard(tickets, 'b1', { exclude: ['org/a'] })).toEqual(['org/b', 'org/c']);
  });

  it('does not count repos from other boards', () => {
    expect(topReposForBoard(tickets, 'b1')).not.toContain('org/z');
  });

  it('returns an empty list when the board has no repository links', () => {
    expect(topReposForBoard([makeTicket({ boardId: 'b1', links: [] })], 'b1')).toEqual([]);
  });

  // ── Recency weighting (#401 follow-up) ──
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.parse('2026-07-18T00:00:00.000Z');
  const daysAgo = (n: number) => new Date(NOW - n * DAY).toISOString();
  const repoLinkedAt = (ref: string, iso: string) =>
    makeTicket({ id: `${ref}@${iso}`, boardId: 'b1', links: [link({ type: 'repository', ref, createdAt: iso })] });

  it('ranks a more recently linked repo above an older one at equal count', () => {
    // WHY: the whole point of the change — recency must reorder repos that would
    // otherwise tie on raw count, so the repo used yesterday beats the one used
    // months ago.
    const recentVsOld = [repoLinkedAt('org/recent', daysAgo(1)), repoLinkedAt('org/old', daysAgo(120))];
    expect(topReposForBoard(recentVsOld, 'b1', { now: NOW })).toEqual(['org/recent', 'org/old']);
  });

  it('lets recency overcome a higher raw count', () => {
    // WHY: one fresh link (weight ~1) must be able to outrank two stale links
    // (2 × ~0.125 at three half-lives ≈ 0.25). Recency genuinely reweights
    // frequency rather than just breaking ties.
    const freshVsStale = [
      repoLinkedAt('org/fresh', daysAgo(0)),
      repoLinkedAt('org/stale', daysAgo(180)),
      repoLinkedAt('org/stale', daysAgo(180)),
    ];
    expect(topReposForBoard(freshVsStale, 'b1', { now: NOW })).toEqual(['org/fresh', 'org/stale']);
  });

  it('preserves relative ranking on a long-dormant board (no cutoff)', () => {
    // WHY: this is the property NaS asked for — a quiet quarter (or year) must
    // not wipe the ranking. All weights shrink by the same factor as `now`
    // advances, so the order is invariant regardless of how stale everything is.
    const dormant = [
      repoLinkedAt('org/top', daysAgo(200)),
      repoLinkedAt('org/top', daysAgo(230)),
      repoLinkedAt('org/mid', daysAgo(210)),
      repoLinkedAt('org/low', daysAgo(400)),
    ];
    const atNow = topReposForBoard(dormant, 'b1', { now: NOW });
    const aYearLater = topReposForBoard(dormant, 'b1', { now: NOW + 365 * DAY });
    expect(atNow).toEqual(['org/top', 'org/mid', 'org/low']);
    expect(aYearLater).toEqual(atNow);
  });

  it('treats a missing/invalid link date as fresh rather than dropping the repo', () => {
    // WHY: a data glitch (unparseable createdAt) must never silently bury an
    // otherwise-relevant repo — it is weighted as "just now" and still ranked.
    const withBadDate = [repoLinkedAt('org/valid', daysAgo(90)), repoLinkedAt('org/glitch', 'not-a-date')];
    const ranked = topReposForBoard(withBadDate, 'b1', { now: NOW });
    expect(ranked).toContain('org/glitch');
    expect(ranked[0]).toBe('org/glitch'); // full weight (age 0) beats the 90-day-old one
  });
});

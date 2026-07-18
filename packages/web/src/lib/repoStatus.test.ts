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
  // WHY: the suggestion must rank by how often a repo is actually used on THIS
  // board so the 1-click default is the likely-right one; ties break
  // alphabetically so the order is deterministic (no flicker between renders).
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
});

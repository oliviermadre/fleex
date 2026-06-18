import { describe, it, expect } from 'vitest';
import { ListWorktreeDetailsUseCase } from '../../src/application/use-cases/list-worktree-details.js';
import type { ListWorktreesUseCase } from '../../src/application/use-cases/list-worktrees.js';
import type { GitPort } from '../../src/application/ports/git.port.js';
import type { TicketStorePort } from '../../src/application/ports/ticket-store.port.js';
import type { RepoPathResolver } from '../../src/domain/services/repo-path-resolver.js';
import type { LoggerPort } from '../../src/application/ports/logger.port.js';

const ORG = 'acme';
const NAME = 'web';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} } as unknown as LoggerPort;

function makeTicket(id: string, displayId: number, status: string, refs: string[]) {
  return {
    id,
    displayId,
    status,
    links: refs.map((ref, i) => ({ id: `l${i}`, type: 'worktree', ref, label: '', url: null, createdAt: '' })),
  };
}

function build(opts: {
  worktrees: { path: string; branch: string; isMain?: boolean; isBare?: boolean }[];
  tickets?: ReturnType<typeof makeTicket>[];
  git?: Partial<GitPort>;
}) {
  const listWorktrees = {
    execute: async () => opts.worktrees.map((w) => ({ isMain: false, isBare: false, ...w })),
  } as unknown as ListWorktreesUseCase;

  const ticketStore = {
    getAllTickets: async () => (opts.tickets ?? []),
  } as unknown as TicketStorePort;

  const git = {
    getLastCommitDate: async () => '2026-05-30T10:00:00.000Z',
    getDiffStats: async () => ({ commitsAhead: 2, commitsBehind: 1, filesChanged: 0, additions: 0, deletions: 0 }),
    ...opts.git,
  } as unknown as GitPort;

  const resolver = { barePath: () => `/bare/${ORG}/${NAME}.git` } as unknown as RepoPathResolver;

  return new ListWorktreeDetailsUseCase(listWorktrees, git, ticketStore, resolver, silentLogger);
}

describe('ListWorktreeDetailsUseCase', () => {
  it('excludes bare and main worktrees', async () => {
    const uc = build({
      worktrees: [
        { path: '/bare', branch: 'main', isBare: true },
        { path: '/main', branch: 'main', isMain: true },
        { path: '/wt/feature', branch: 'feature' },
      ],
    });
    const result = await uc.execute(ORG, NAME);
    expect(result).toHaveLength(1);
    expect(result[0]!.branch).toBe('feature');
  });

  it('links a ticket by worktree path', async () => {
    const uc = build({
      worktrees: [{ path: '/wt/feature', branch: 'feature' }],
      tickets: [makeTicket('t1', 42, 'doing', ['/wt/feature'])],
    });
    const [wt] = await uc.execute(ORG, NAME);
    expect(wt!.linkedTicket).toEqual({ id: 't1', displayId: 42, status: 'doing' });
  });

  it('links a ticket by org/name:branch ref', async () => {
    const uc = build({
      worktrees: [{ path: '/wt/feature', branch: 'feature' }],
      tickets: [makeTicket('t2', 7, 'reviewing', [`${ORG}/${NAME}:feature`])],
    });
    const [wt] = await uc.execute(ORG, NAME);
    expect(wt!.linkedTicket).toEqual({ id: 't2', displayId: 7, status: 'reviewing' });
  });

  it('returns null linkedTicket when no link matches', async () => {
    const uc = build({
      worktrees: [{ path: '/wt/orphan', branch: 'orphan' }],
      tickets: [makeTicket('t1', 1, 'doing', ['/wt/other'])],
    });
    const [wt] = await uc.execute(ORG, NAME);
    expect(wt!.linkedTicket).toBeNull();
  });

  it('degrades gracefully when git calls fail', async () => {
    const uc = build({
      worktrees: [{ path: '/wt/feature', branch: 'feature' }],
      git: {
        getLastCommitDate: async () => { throw new Error('boom'); },
        getDiffStats: async () => { throw new Error('boom'); },
      },
    });
    const [wt] = await uc.execute(ORG, NAME);
    expect(wt!.lastCommitAt).toBeNull();
    expect(wt!.commitsAhead).toBe(0);
    expect(wt!.commitsBehind).toBe(0);
  });

  it('carries through commit stats and date', async () => {
    const uc = build({ worktrees: [{ path: '/wt/feature', branch: 'feature' }] });
    const [wt] = await uc.execute(ORG, NAME);
    expect(wt!.lastCommitAt).toBe('2026-05-30T10:00:00.000Z');
    expect(wt!.commitsAhead).toBe(2);
    expect(wt!.commitsBehind).toBe(1);
  });
});

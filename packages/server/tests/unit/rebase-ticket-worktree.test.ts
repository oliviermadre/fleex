import { describe, it, expect } from 'vitest';
import { RebaseTicketWorktreeUseCase } from '../../src/application/use-cases/rebase-ticket-worktree.js';
import { FakeLoggerPort } from '../helpers/fakes.js';

// ---------------------------------------------------------------------------
// Changing a repo's base branch once its worktree exists means throwing the
// worktree away and deriving it again. That is only allowed when nothing can be
// lost: the worktree is on the ticket's own branch, that branch carries no
// commits of its own, nothing is uncommitted, and no agent or terminal uses it.
// ---------------------------------------------------------------------------

const BARE = '/bare/o/front';
const WT = '/ws/1-x/front';
const BRANCH = 'ticket/1-x';

function harness(overrides: {
  worktreeBranch?: string | null;
  status?: string;
  ownCommits?: number;
  executions?: Array<{ status: string }>;
  sessions?: Array<{ status: string; cwd: string }>;
} = {}) {
  const calls: string[] = [];
  const created: unknown[] = [];
  const git = {
    listWorktrees: async () =>
      overrides.worktreeBranch === null ? [] : [{ path: WT, branch: overrides.worktreeBranch ?? BRANCH }],
    getStatusPorcelain: async () => overrides.status ?? '',
    countOwnCommits: async () => overrides.ownCommits ?? 0,
    removeWorktree: async (_bare: string, wtPath: string) => {
      calls.push(`remove ${wtPath}`);
    },
  };
  const createWorktree = {
    execute: async (org: string, name: string, wtPath: string, request: unknown) => {
      calls.push(`create ${wtPath}`);
      created.push({ org, name, wtPath, request });
      return null;
    },
  };
  const agentEventStore = { getExecutionsByTicket: async () => overrides.executions ?? [] };
  const sessionStore = { getAll: async () => overrides.sessions ?? [] };
  const uc = new RebaseTicketWorktreeUseCase(
    git as never, createWorktree as never, agentEventStore as never, sessionStore as never, new FakeLoggerPort(),
  );
  return { uc, calls, created };
}

const target = { ticketId: 'tkt-1', barePath: BARE, wtPath: WT, ticketBranch: BRANCH };

describe('RebaseTicketWorktreeUseCase.findBlocker', () => {
  it('allows a clean, idle worktree whose branch has no commits of its own', async () => {
    expect(await harness().uc.findBlocker(target)).toBeNull();
  });

  it('refuses a worktree checked out on another branch (e.g. a PR head)', async () => {
    expect(await harness({ worktreeBranch: 'feat/pr-42' }).uc.findBlocker(target)).toMatch(/feat\/pr-42/);
  });

  it('refuses a path git does not know as a worktree', async () => {
    expect(await harness({ worktreeBranch: null }).uc.findBlocker(target)).toMatch(/not a registered worktree/);
  });

  it('refuses while an agent is running on the ticket', async () => {
    const h = harness({ executions: [{ status: 'completed' }, { status: 'running' }] });
    expect(await h.uc.findBlocker(target)).toMatch(/agent is running/);
  });

  it('refuses while a live terminal session sits inside the worktree, ignoring the others', async () => {
    const elsewhere = harness({
      sessions: [
        { status: 'running', cwd: `${WT}-other` },
        { status: 'dead', cwd: `${WT}/src` },
      ],
    });
    expect(await elsewhere.uc.findBlocker(target)).toBeNull();

    const inside = harness({ sessions: [{ status: 'running', cwd: `${WT}/src` }] });
    expect(await inside.uc.findBlocker(target)).toMatch(/terminal session/);
  });

  it('refuses a worktree with uncommitted changes', async () => {
    expect(await harness({ status: ' M src/app.ts\n' }).uc.findBlocker(target)).toMatch(/uncommitted changes/);
  });

  it('refuses a branch that carries commits of its own', async () => {
    expect(await harness({ ownCommits: 2 }).uc.findBlocker(target)).toMatch(/2 commit/);
  });
});

describe('RebaseTicketWorktreeUseCase.recreate', () => {
  it('removes the worktree, then derives the ticket branch again from the new base', async () => {
    const h = harness();
    await h.uc.recreate({
      org: 'o', name: 'front', barePath: BARE, wtPath: WT, ticketBranch: BRANCH, baseRef: 'origin/feat/1887',
    });
    expect(h.calls).toEqual([`remove ${WT}`, `create ${WT}`]);
    expect(h.created[0]).toEqual({
      org: 'o', name: 'front', wtPath: WT,
      request: { branch: BRANCH, createNewBranch: true, baseBranch: 'origin/feat/1887' },
    });
  });

  it('omits the base so the repository default applies', async () => {
    const h = harness();
    await h.uc.recreate({ org: 'o', name: 'front', barePath: BARE, wtPath: WT, ticketBranch: BRANCH });
    expect(h.created[0]).toEqual({
      org: 'o', name: 'front', wtPath: WT,
      request: { branch: BRANCH, createNewBranch: true },
    });
  });
});

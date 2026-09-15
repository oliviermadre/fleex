import { describe, it, expect } from 'vitest';
import type { TicketLink } from '@fleex/shared';
import {
  normalizeBaseBranchInput,
  resolveBaseRef,
} from '../../src/domain/services/branch-utils.js';
import { TicketEntity } from '../../src/domain/entities/ticket.entity.js';
import { GitCliAdapter } from '../../src/infrastructure/adapters/git-cli.adapter.js';
import { CreateWorktreeUseCase } from '../../src/application/use-cases/create-worktree.js';
import { WorktreeError } from '../../src/domain/errors.js';
import { FakeLoggerPort } from '../helpers/fakes.js';
import type { ExecFn, ExecResult } from '../../src/infrastructure/host/types.js';

// ── normalizeBaseBranchInput ──────────────────────────────────────────────

describe('normalizeBaseBranchInput', () => {
  it('strips a leading origin/ prefix (a base is stored bare)', () => {
    expect(normalizeBaseBranchInput('origin/feat/x')).toEqual({ ok: true, branch: 'feat/x' });
  });

  it('keeps a bare branch untouched (including inner slashes)', () => {
    expect(normalizeBaseBranchInput('feat/a/b')).toEqual({ ok: true, branch: 'feat/a/b' });
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeBaseBranchInput('  feat/x  ')).toEqual({ ok: true, branch: 'feat/x' });
  });

  it('rejects a fully-qualified ref', () => {
    const r = normalizeBaseBranchInput('refs/heads/feat/x');
    expect(r.ok).toBe(false);
  });

  it('rejects an empty input', () => {
    expect(normalizeBaseBranchInput('   ').ok).toBe(false);
  });
});

// ── resolveBaseRef ────────────────────────────────────────────────────────

describe('resolveBaseRef', () => {
  const repoLink = (ref: string, baseBranch?: string): TicketLink => ({
    id: ref, type: 'repository', ref, label: ref, url: null, createdAt: 'now',
    ...(baseBranch ? { baseBranch } : {}),
  });

  it('returns origin/<base> for a repository link with a custom base', () => {
    const links = [repoLink('evaneos/odys-front', 'feat/big-refacto')];
    expect(resolveBaseRef(links, 'evaneos', 'odys-front')).toBe('origin/feat/big-refacto');
  });

  it('returns undefined when the link has no base branch', () => {
    const links = [repoLink('evaneos/odys-front')];
    expect(resolveBaseRef(links, 'evaneos', 'odys-front')).toBeUndefined();
  });

  it('returns undefined when no repository link matches org/name', () => {
    const links = [repoLink('evaneos/other', 'feat/x')];
    expect(resolveBaseRef(links, 'evaneos', 'odys-front')).toBeUndefined();
  });
});

// ── TicketEntity link base branch ─────────────────────────────────────────

describe('TicketEntity — base branch on repository links', () => {
  const newTicket = () => TicketEntity.create({ id: 'tkt-1', boardId: 'b', displayId: 1, title: 'T' });

  it('stores baseBranch only on repository links', () => {
    const t = newTicket();
    const repo = t.addLink('repository', 'o/n', 'n', null, 'lnk-1', 'feat/x');
    expect(repo.baseBranch).toBe('feat/x');

    // Any non-repository link ignores a passed base branch entirely.
    const wt = t.addLink('worktree', '/abs/path', 'branch', null, 'lnk-2', 'feat/x');
    expect(wt.baseBranch).toBeUndefined();
  });

  it('setLinkBaseBranch updates, clears, and reports the diff', () => {
    const t = newTicket();
    t.addLink('repository', 'o/n', 'n', null, 'lnk-1', 'feat/x');

    const changed = t.setLinkBaseBranch('lnk-1', 'feat/y');
    expect(changed).toEqual({ from: 'feat/x', to: 'feat/y' });
    expect(t.findLinkById('lnk-1')?.baseBranch).toBe('feat/y');

    const cleared = t.setLinkBaseBranch('lnk-1', undefined);
    expect(cleared).toEqual({ from: 'feat/y', to: undefined });
    expect(t.findLinkById('lnk-1')?.baseBranch).toBeUndefined();
  });

  it('setLinkBaseBranch is a no-op (null diff) when unchanged or link is wrong', () => {
    const t = newTicket();
    t.addLink('repository', 'o/n', 'n', null, 'lnk-1', 'feat/x');
    expect(t.setLinkBaseBranch('lnk-1', 'feat/x')).toBeNull(); // unchanged
    expect(t.setLinkBaseBranch('missing', 'feat/x')).toBeNull(); // unknown link

    t.addLink('worktree', '/p', 'b', null, 'lnk-2');
    expect(t.setLinkBaseBranch('lnk-2', 'feat/x')).toBeNull(); // non-repository
  });
});

// ── GitCliAdapter.createWorktree — --no-track ─────────────────────────────

describe('GitCliAdapter.createWorktree', () => {
  const makeAdapter = () => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_cmd, args): Promise<ExecResult> => {
      calls.push(args);
      return { stdout: '', stderr: '' };
    };
    return { adapter: new GitCliAdapter(exec, new FakeLoggerPort()), calls };
  };

  it('adds --no-track and the base when creating a new branch from a base', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.createWorktree('/bare', '/wt', 'agent/1-x', true, 'origin/feat/x');
    expect(calls[0]).toEqual(['worktree', 'add', '--no-track', '-b', 'agent/1-x', '/wt', 'origin/feat/x']);
  });

  it('creates a new branch without --no-track when there is no base', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.createWorktree('/bare', '/wt', 'agent/1-x', true);
    expect(calls[0]).toEqual(['worktree', 'add', '-b', 'agent/1-x', '/wt']);
  });

  it('checks out an existing branch unchanged', async () => {
    const { adapter, calls } = makeAdapter();
    await adapter.createWorktree('/bare', '/wt', 'existing', false);
    expect(calls[0]).toEqual(['worktree', 'add', '/wt', 'existing']);
  });
});

// ── CreateWorktreeUseCase — base threading + D7 fail-loud ──────────────────

describe('CreateWorktreeUseCase — base branch', () => {
  const makeUC = (createWorktreeImpl: (base?: string) => Promise<void>) => {
    const calls: Array<{ branch: string; createNew: boolean; base?: string }> = [];
    const git = {
      createWorktree: async (_bare: string, _wt: string, branch: string, createNew: boolean, base?: string) => {
        calls.push({ branch, createNew, base });
        return createWorktreeImpl(base);
      },
      getDefaultBranch: async () => 'main',
      removeWorktree: async () => {},
      pruneWorktrees: async () => {},
      repairWorktrees: async () => {},
      fetchRef: async () => {},
    };
    const bareCloneManager = { ensureBareClone: async () => {}, fetch: async () => {} };
    const overlayManager = { applyOverlay: async () => {}, firePostCheckoutHooks: () => false };
    const resolver = { barePath: (o: string, n: string) => `/bare/${o}/${n}` };
    const uc = new CreateWorktreeUseCase(
      git as never, new FakeLoggerPort(), bareCloneManager as never, overlayManager as never, resolver as never,
    );
    return { uc, calls };
  };

  it('passes an explicit base straight through to git (no default lookup)', async () => {
    const { uc, calls } = makeUC(async () => {});
    await uc.execute('evaneos', 'odys-front', '/wt', {
      branch: 'agent/1-x', createNewBranch: true, baseBranch: 'origin/feat/x',
    });
    expect(calls[0]).toMatchObject({ base: 'origin/feat/x', createNew: true });
  });

  it('fails loud when a custom base is missing on origin (never falls back)', async () => {
    const { uc } = makeUC(async () => {
      throw { stderr: "fatal: invalid reference: origin/feat/gone" };
    });
    await expect(
      uc.execute('evaneos', 'odys-front', '/wt', {
        branch: 'agent/1-x', createNewBranch: true, baseBranch: 'origin/feat/gone',
      }),
    ).rejects.toThrow(/Base branch 'feat\/gone' not found on origin for evaneos\/odys-front/);
    await expect(
      uc.execute('evaneos', 'odys-front', '/wt', {
        branch: 'agent/1-x', createNewBranch: true, baseBranch: 'origin/feat/gone',
      }),
    ).rejects.toBeInstanceOf(WorktreeError);
  });
});

// ── GitCliAdapter — existing-branch helpers ───────────────────────────────

describe('GitCliAdapter — existing-branch helpers', () => {
  const makeAdapter = (impl: (args: string[]) => ExecResult) => {
    const calls: string[][] = [];
    const exec: ExecFn = async (_cmd, args): Promise<ExecResult> => {
      calls.push(args);
      return impl(args);
    };
    return { adapter: new GitCliAdapter(exec, new FakeLoggerPort()), calls };
  };

  it('forceBranch re-points the branch without adopting the base as upstream', async () => {
    const { adapter, calls } = makeAdapter(() => ({ stdout: '', stderr: '' }));
    await adapter.forceBranch('/bare', 'ticket/1-x', 'origin/feat/x');
    expect(calls[0]).toEqual(['branch', '-f', '--no-track', 'ticket/1-x', 'origin/feat/x']);
  });

  it("countOwnCommits counts commits no other remote branch has, ignoring the branch's own origin copy", async () => {
    const { adapter, calls } = makeAdapter(() => ({ stdout: '2\n', stderr: '' }));
    expect(await adapter.countOwnCommits('/bare', 'ticket/1-x')).toBe(2);
    expect(calls[0]).toEqual(['rev-list', '--count', 'ticket/1-x', '--not', '--exclude=origin/ticket/1-x', '--remotes']);
  });

  it('isAncestor maps a clean exit to true and a failing one to false', async () => {
    const yes = makeAdapter(() => ({ stdout: '', stderr: '' }));
    expect(await yes.adapter.isAncestor('/bare', 'origin/main', 'ticket/1-x')).toBe(true);
    expect(yes.calls[0]).toEqual(['merge-base', '--is-ancestor', 'origin/main', 'ticket/1-x']);

    const no = makeAdapter(() => {
      throw Object.assign(new Error('Command failed'), { code: 1 });
    });
    expect(await no.adapter.isAncestor('/bare', 'origin/main', 'ticket/1-x')).toBe(false);
  });
});

// ── CreateWorktreeUseCase — the ticket branch already exists ──────────────
// Unlinking a repo removes its worktree but keeps the branch. Re-linking must
// not silently check that stale branch out on its old base.

describe('CreateWorktreeUseCase — existing ticket branch', () => {
  const makeUC = (opts: { ownCommits: number; baseIsAncestor?: boolean }) => {
    const calls: Array<{ branch: string; createNew: boolean; base?: string }> = [];
    const forced: Array<{ branch: string; startPoint: string }> = [];
    const git = {
      createWorktree: async (_bare: string, _wt: string, branch: string, createNew: boolean, base?: string) => {
        calls.push({ branch, createNew, base });
        if (createNew) throw { stderr: `fatal: a branch named '${branch}' already exists` };
      },
      countOwnCommits: async () => opts.ownCommits,
      isAncestor: async () => opts.baseIsAncestor ?? false,
      forceBranch: async (_bare: string, branch: string, startPoint: string) => {
        forced.push({ branch, startPoint });
      },
      getDefaultBranch: async () => 'main',
      removeWorktree: async () => {},
      pruneWorktrees: async () => {},
      repairWorktrees: async () => {},
      fetchRef: async () => {},
    };
    const bareCloneManager = { ensureBareClone: async () => {}, fetch: async () => {} };
    const overlayManager = { applyOverlay: async () => {}, firePostCheckoutHooks: () => false };
    const resolver = { barePath: (o: string, n: string) => `/bare/${o}/${n}` };
    const uc = new CreateWorktreeUseCase(
      git as never, new FakeLoggerPort(), bareCloneManager as never, overlayManager as never, resolver as never,
    );
    return { uc, calls, forced };
  };

  it('moves a branch with no commits of its own onto the requested base, then checks it out', async () => {
    const { uc, calls, forced } = makeUC({ ownCommits: 0 });
    await uc.execute('evaneos', 'odys-front', '/wt', {
      branch: 'ticket/1-x', createNewBranch: true, baseBranch: 'origin/feat/1887',
    });
    expect(forced).toEqual([{ branch: 'ticket/1-x', startPoint: 'origin/feat/1887' }]);
    expect(calls.at(-1)).toMatchObject({ branch: 'ticket/1-x', createNew: false });
  });

  it('moves it onto the default branch when no custom base is requested', async () => {
    const { uc, forced } = makeUC({ ownCommits: 0 });
    await uc.execute('evaneos', 'odys-front', '/wt', { branch: 'ticket/1-x', createNewBranch: true });
    expect(forced).toEqual([{ branch: 'ticket/1-x', startPoint: 'origin/main' }]);
  });

  it('moves it even when the new base is already an ancestor of the stale branch', async () => {
    // agent/550 contains main: containing the base is not being on it.
    const { uc, forced } = makeUC({ ownCommits: 0, baseIsAncestor: true });
    await uc.execute('evaneos', 'odys-front', '/wt', { branch: 'ticket/1-x', createNewBranch: true });
    expect(forced).toHaveLength(1);
  });

  it('reuses a branch with commits of its own when it already contains the custom base', async () => {
    const { uc, calls, forced } = makeUC({ ownCommits: 3, baseIsAncestor: true });
    await uc.execute('evaneos', 'odys-front', '/wt', {
      branch: 'ticket/1-x', createNewBranch: true, baseBranch: 'origin/feat/x',
    });
    expect(forced).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ createNew: false });
  });

  it('fails loud rather than check out a branch with commits of its own on another base', async () => {
    const { uc, calls } = makeUC({ ownCommits: 3, baseIsAncestor: false });
    const run = uc.execute('evaneos', 'odys-front', '/wt', {
      branch: 'ticket/1-x', createNewBranch: true, baseBranch: 'origin/feat/1887',
    });
    await expect(run).rejects.toBeInstanceOf(WorktreeError);
    await expect(run).rejects.toThrow(/ticket\/1-x.*3 commit/);
    expect(calls.every((c) => c.createNew)).toBe(true);
  });

  it('keeps resuming a branch with commits of its own when no custom base is requested', async () => {
    const { uc, calls, forced } = makeUC({ ownCommits: 3, baseIsAncestor: false });
    await uc.execute('evaneos', 'odys-front', '/wt', { branch: 'ticket/1-x', createNewBranch: true });
    expect(forced).toEqual([]);
    expect(calls.at(-1)).toMatchObject({ createNew: false });
  });
});

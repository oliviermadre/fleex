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

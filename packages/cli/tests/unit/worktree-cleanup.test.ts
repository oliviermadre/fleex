/**
 * `fleex worktree cleanup` client side: refuses what must be refused before
 * reaching the server (an active status, a bad duration, an unattended apply
 * without --yes), keeps `--json` stdout parseable for the weekly routine, and
 * maps the server's answers onto the documented exit codes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorktreeCleanupReport, WorktreeCleanupWorktree } from '@fleex/shared';

const apiCall = vi.fn();
vi.mock('../../src/core/api.ts', () => ({
  apiBase: () => 'http://localhost:1234',
  apiCall: (...args: unknown[]) => apiCall(...args),
}));

const prompt = { tty: true, answer: false };
vi.mock('../../src/core/prompt.ts', () => ({
  canPrompt: () => prompt.tty,
  promptYesNo: async () => prompt.answer,
  closePrompts: () => {},
}));

import { setJsonMode } from '../../src/core/colors.ts';
import cleanupDef from '../../src/commands/worktree/cleanup/index.ts';
import { renderApply, renderPlan, reasonText } from '../../src/commands/worktree/cleanup/_render.ts';

function wt(over: Partial<WorktreeCleanupWorktree> = {}): WorktreeCleanupWorktree {
  return {
    path: '/p/workspaces/a1f3c9-x/odys-api', repo: 'odys-travel/odys-api', branch: 'ticket/x', sizeBytes: 1024 ** 3,
    decision: 'eligible', reasons: [], branchAction: 'delete_local_merged',
    details: { unpushedCommits: 0, dirtyLines: 0, untracked: [], prs: [], tmuxPanes: 0, processes: [] },
    ...over,
  };
}

function report(over: Partial<WorktreeCleanupReport> = {}): WorktreeCleanupReport {
  return {
    version: 1, mode: 'plan', generatedAt: '2026-10-12T00:00:00Z', basePath: '/p',
    criteria: { olderThan: '14d', olderThanDays: 14, statuses: ['done', 'cancelled'], ticket: null },
    tickets: [{
      ticketId: 't1', displayId: 561, title: 'Bootstrap agentic-dmc-2', status: 'done', statusChangedAt: null, closedForDays: 25,
      workspacePath: '/p/workspaces/a1f3c9-x',
      worktrees: [
        wt(),
        wt({ path: '/p/workspaces/a1f3c9-x/odys-front', repo: 'odys-travel/odys-front', decision: 'excluded', reasons: ['unpushed_commits', 'untracked_files'],
          details: { unpushedCommits: 3, dirtyLines: 0, untracked: ['a', 'b'], prs: [], tmuxPanes: 0, processes: [] } }),
      ],
      orphanLinks: [{ linkId: 'l', ref: '/p/workspaces/c4d2e0-y/fleex', label: 'b' }],
    }],
    skipped: [{ ticketId: 't2', displayId: 598, title: 'fix i18n header', status: 'done', closedForDays: 6 }],
    emptyWorkspaces: [],
    unknown: [{ path: '/p/workspaces/tmp-experiments', reason: 'no_manifest', ticketId: null, sizeBytes: 2048 }],
    totals: { ticketsScanned: 2, ticketsInScope: 1, worktreesEligible: 1, worktreesExcluded: 1, orphanLinks: 1, emptyWorkspaces: 0, unknownDirs: 1, reclaimableBytes: 1024 ** 3 },
    ...over,
  };
}

class Exit extends Error { constructor(public code: number) { super(`exit ${code}`); } }

let stdout: string;
let stderr: string;
const run = (opts: Record<string, unknown>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (cleanupDef.action as any)({ olderThan: '14d', status: 'done,cancelled', size: true, ...opts });

beforeEach(() => {
  stdout = '';
  stderr = '';
  apiCall.mockReset();
  prompt.tty = true;
  prompt.answer = false;
  vi.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => { stdout += String(c); return true; }) as never);
  vi.spyOn(process.stderr, 'write').mockImplementation(((c: unknown) => { stderr += String(c); return true; }) as never);
  vi.spyOn(process, 'exit').mockImplementation(((code: number) => { throw new Exit(code); }) as never);
});

afterEach(() => {
  setJsonMode(false);
  vi.restoreAllMocks();
});

describe('fleex worktree cleanup — refusals before any server call', () => {
  it.each([['--status doing', { status: 'doing' }], ['--status done,todo', { status: 'done,todo' }], ['--older-than soon', { olderThan: 'soon' }]])(
    '%s → exit 1, server never called',
    async (_label, opts) => {
      await expect(run(opts)).rejects.toMatchObject({ code: 1 });
      expect(apiCall).not.toHaveBeenCalled();
    },
  );

  it('--apply without --yes on a non-TTY → exit 1 (a routine must opt in explicitly)', async () => {
    prompt.tty = false;
    await expect(run({ apply: true })).rejects.toMatchObject({ code: 1 });
    expect(stderr).toContain('Refusing to apply without --yes in non-interactive mode');
    expect(apiCall).not.toHaveBeenCalled();
  });
});

describe('fleex worktree cleanup — dry-run and apply', () => {
  it('dry-run only reads the plan', async () => {
    apiCall.mockResolvedValue(report());
    await run({});
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(apiCall.mock.calls[0]![0]).toBe('GET');
    expect(apiCall.mock.calls[0]![1]).toContain('/api/worktree-cleanup/plan?olderThan=14d&status=done%2Ccancelled&size=true');
    expect(stdout).toContain('Run again with --apply');
  });

  it('--json: the whole of stdout is the report, progress goes to stderr', async () => {
    setJsonMode(true);
    apiCall.mockResolvedValue(report());
    await run({ json: true });
    expect(JSON.parse(stdout)).toMatchObject({ version: 1, totals: { worktreesEligible: 1 } });
    expect(stderr).toBe('');
  });

  it('declining the confirmation applies nothing (exit 0)', async () => {
    apiCall.mockResolvedValue(report());
    await run({ apply: true });
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(stderr).toContain('Nothing was changed');
  });

  it('confirming POSTs the criteria — never the plan — to apply', async () => {
    prompt.answer = true;
    apiCall.mockResolvedValueOnce(report()).mockResolvedValueOnce(report({ mode: 'apply', totals: { ...report().totals, removed: 1, failed: 0 } }));
    await run({ apply: true });
    expect(apiCall.mock.calls[1]!.slice(0, 3)).toEqual(['POST', 'http://localhost:1234/api/worktree-cleanup/apply', { olderThan: '14d', status: 'done,cancelled', size: true }]);
  });

  it('--apply --yes --json: unattended, JSON only, exit 2 when a worktree failed', async () => {
    setJsonMode(true);
    prompt.tty = false;
    apiCall.mockResolvedValue(report({ mode: 'apply', totals: { ...report().totals, removed: 0, failed: 1 } }));
    await expect(run({ apply: true, yes: true, json: true })).rejects.toMatchObject({ code: 2 });
    expect(apiCall).toHaveBeenCalledTimes(1);
    expect(JSON.parse(stdout).mode).toBe('apply');
  });

  it('a cleanup already running (HTTP 409) → exit 3', async () => {
    apiCall.mockRejectedValue(new Error('HTTP 409: A worktree cleanup is already running'));
    await expect(run({ apply: true, yes: true })).rejects.toMatchObject({ code: 3 });
  });
});

describe('fleex worktree cleanup — text report', () => {
  const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');

  it('lists what goes (with size), what stays with every reason, orphan links and unknown folders', () => {
    const text = strip(renderPlan(report()));
    expect(text).toMatch(/TO REMOVE {2}1 worktree · 1\.0 GB/);
    expect(text).toMatch(/#561 +Bootstrap agentic-dmc-2 +done +25 d +1 wt +1\.0 GB \(\+1 kept\)/);
    expect(text).toMatch(/KEPT {2}1 worktree\n.*odys-front +unpushed_commits \(3 commits\), untracked_files \(2\)/);
    expect(text).toContain('ORPHAN LINKS TO PURGE  1');
    expect(text).toMatch(/tmp-experiments +no_manifest +2\.0 KB/);
    expect(text).not.toContain('BELOW THRESHOLD');
    expect(strip(renderPlan(report(), { verbose: true }))).toMatch(/BELOW THRESHOLD[\s\S]*#598 +fix i18n header/);
  });

  it('reason details name the PRs and processes involved', () => {
    expect(reasonText(wt({ reasons: ['pr_open', 'process_running'], details: { ...wt().details, prs: [{ number: 298, state: 'OPEN' }], processes: [{ pid: 48213, command: 'node' }] } })))
      .toBe('pr_open (#298), process_running (node 48213)');
  });

  it('apply output shows one line per worktree and the totals', () => {
    const r = report({ mode: 'apply', totals: { ...report().totals, removed: 1, skipped: 0, failed: 0, freedBytes: 1024 ** 3, purgedLinks: 1 } });
    r.tickets[0]!.worktrees[0]!.result = 'removed';
    r.tickets[0]!.orphanLinks[0]!.result = 'purged';
    const text = strip(renderApply(r));
    expect(text).toMatch(/✓ #561 +odys-api .*branch -D · link removed {2}removed/);
    expect(text).toMatch(/✓ #561 +orphan link .*purged/);
    expect(text).toContain('Done: 1 removed · 0 skipped_guard · 0 failed · 1.0 GB freed · 1 link purged');
  });
});

describe('--older-than durations', () => {
  it('accepts hours, days, weeks and bare days; rejects the rest', async () => {
    const { parseCleanupOlderThan } = await import('@fleex/shared');
    const H = 3_600_000;
    expect(parseCleanupOlderThan('36h')).toBe(36 * H);
    expect(parseCleanupOlderThan('14d')).toBe(14 * 24 * H);
    expect(parseCleanupOlderThan('14')).toBe(14 * 24 * H);
    expect(parseCleanupOlderThan('2w')).toBe(14 * 24 * H);
    for (const bad of ['', 'soon', '14m', '-1d', 'd']) expect(parseCleanupOlderThan(bad)).toBeNull();
  });
});

describe('orphan links section', () => {
  it('shows a sample of 10 by default, all of them with -v', () => {
    const r = report();
    r.tickets[0]!.orphanLinks = Array.from({ length: 25 }, (_, i) => ({ linkId: `l${i}`, ref: `/p/workspaces/x/r${i}`, label: null }));
    const strip = (s: string) => s.replace(/\x1b\[[0-9;]*m/g, '');
    expect(strip(renderPlan(r))).toContain('… 15 more (-v to list them all)');
    expect(strip(renderPlan(r, { verbose: true }))).toContain('/p/workspaces/x/r24 (absent)');
  });
});

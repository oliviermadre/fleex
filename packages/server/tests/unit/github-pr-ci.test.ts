import { describe, it, expect } from 'vitest';
import { GitHubGraphQLAdapter } from '../../src/infrastructure/adapters/github-graphql.adapter.js';
import { FakeLoggerPort } from '../helpers/fakes.js';
import type { ExecFn } from '../../src/infrastructure/host/types.js';

const SHA = 'a'.repeat(40);

function makeAdapter(impl: (args: string[]) => string) {
  const calls: { cmd: string; args: string[]; options?: { timeout?: number; cwd?: string } }[] = [];
  const exec: ExecFn = async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { stdout: impl(args), stderr: '' };
  };
  const queries = () => calls.map((c) => c.args.find((a) => a.startsWith('query=')) ?? '');
  return { adapter: new GitHubGraphQLAdapter(exec, new FakeLoggerPort()), calls, queries };
}

const rollup = (contexts: unknown) => ({ commits: { nodes: [{ commit: { statusCheckRollup: contexts === null ? null : { contexts } } }] } });

describe('GitHubGraphQLAdapter.fetchPRCiSummaries', () => {
  it('folds check run and status context counts into one status per PR, keyed by lowercase ref', async () => {
    const { adapter, queries } = makeAdapter(() => JSON.stringify({
      pr0: { pullRequest: { state: 'OPEN', isDraft: false, ...rollup({
        checkRunCountsByState: [{ state: 'SUCCESS', count: 3 }, { state: 'IN_PROGRESS', count: 1 }],
        statusContextCountsByState: [{ state: 'FAILURE', count: 1 }],
      }) } },
      pr1: { pullRequest: { state: 'OPEN', isDraft: true, ...rollup(null) } },
      pr2: { pullRequest: null },
    }));

    const out = await adapter.fetchPRCiSummaries([
      { org: 'Evaneos', name: 'Fleex', number: 1 },
      { org: 'o', name: 'n', number: 2 },
      { org: 'o', name: 'gone', number: 3 },
    ]);

    expect(Object.fromEntries(out)).toEqual({
      'evaneos/fleex#1': { ref: 'evaneos/fleex#1', state: 'OPEN', isDraft: false, ciStatus: 'failed', counts: { pass: 3, running: 1, fail: 1 } },
      'o/n#2': { ref: 'o/n#2', state: 'OPEN', isDraft: true, ciStatus: 'none', counts: {} },
    });
    // Cheap enough for a whole board: counts only, never the list of checks.
    expect(queries()[0]).toContain('checkRunCountsByState');
    expect(queries()[0]).not.toContain('detailsUrl');
  });

  it('splits more than 50 PRs into several GraphQL calls', async () => {
    const { adapter, calls } = makeAdapter(() => '{}');
    const prs = Array.from({ length: 120 }, (_, i) => ({ org: 'o', name: 'n', number: i + 1 }));
    await adapter.fetchPRCiSummaries(prs);
    expect(calls).toHaveLength(3);
  });

  it('keeps what GitHub resolved when one PR of the batch errors (gh exits non-zero with data on stdout)', async () => {
    const exec: ExecFn = async () => {
      const err = new Error('GraphQL: Could not resolve to a PullRequest') as Error & { stdout: string };
      err.stdout = JSON.stringify({ pr0: { pullRequest: { state: 'MERGED', isDraft: false, ...rollup(null) } }, pr1: { pullRequest: null } });
      throw err;
    };
    const adapter = new GitHubGraphQLAdapter(exec, new FakeLoggerPort());
    const out = await adapter.fetchPRCiSummaries([{ org: 'o', name: 'n', number: 1 }, { org: 'o', name: 'n', number: 999 }]);
    expect([...out.keys()]).toEqual(['o/n#1']);
  });

  it('never interpolates an owner or name that is not a plain GitHub identifier', async () => {
    const { adapter, calls } = makeAdapter(() => '{}');
    await adapter.fetchPRCiSummaries([{ org: 'o") { x }', name: 'n', number: 1 }]);
    expect(calls).toEqual([]);
  });
});

describe('GitHubGraphQLAdapter.fetchPRCiDetail', () => {
  const repo = (pullRequest: unknown) => JSON.stringify({ repository: {
    mergeCommitAllowed: true, squashMergeAllowed: true, rebaseMergeAllowed: false, viewerDefaultMergeMethod: 'SQUASH',
    pullRequest,
  } });

  it('returns sorted checks named "workflow / job", mergeability and the allowed methods', async () => {
    const { adapter } = makeAdapter(() => repo({
      state: 'OPEN', isDraft: false, title: 'Add chip', url: 'https://github.com/o/n/pull/39', baseRefName: 'main',
      headRefOid: SHA, mergeable: 'MERGEABLE', mergeStateStatus: 'UNSTABLE',
      ...rollup({
        totalCount: 3,
        checkRunCountsByState: [{ state: 'SUCCESS', count: 1 }, { state: 'FAILURE', count: 1 }],
        statusContextCountsByState: [{ state: 'PENDING', count: 1 }],
        nodes: [
          { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'SUCCESS', detailsUrl: 'https://x/build',
            startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:02Z', checkSuite: { workflowRun: { workflow: { name: 'CI' } } } },
          { __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'FAILURE', detailsUrl: 'https://x/test',
            startedAt: null, completedAt: null, checkSuite: null },
          { __typename: 'StatusContext', context: 'Vercel', state: 'PENDING', targetUrl: 'https://vercel', createdAt: '2026-01-01T00:00:00Z' },
        ],
      }),
    }));

    const detail = await adapter.fetchPRCiDetail({ org: 'o', name: 'n', number: 39 });

    expect(detail).toMatchObject({
      ref: 'o/n#39', ciStatus: 'failed', counts: { pass: 1, fail: 1, pending: 1 },
      headSha: SHA, baseRefName: 'main', totalChecks: 3,
      mergeable: 'MERGEABLE', mergeStateStatus: 'UNSTABLE', allowedMergeMethods: ['squash', 'merge'],
    });
    expect(detail!.checks.map((c) => [c.name, c.bucket, c.detailsUrl])).toEqual([
      ['test', 'fail', 'https://x/test'],
      ['Vercel', 'pending', 'https://vercel'],
      ['CI / build', 'pass', 'https://x/build'],
    ]);
  });

  it('returns null when GitHub has no such PR', async () => {
    const { adapter } = makeAdapter(() => repo(null));
    expect(await adapter.fetchPRCiDetail({ org: 'o', name: 'n', number: 1 })).toBeNull();
  });
});

describe('GitHubGraphQLAdapter.mergePR', () => {
  it('runs gh pr merge with the method and the head guard, and never deletes the branch', async () => {
    const { adapter, calls } = makeAdapter(() => '');
    await adapter.mergePR({ org: 'o', name: 'n', number: 39, method: 'squash', headSha: SHA });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.cmd).toBe('gh');
    expect(calls[0]!.args).toEqual(['pr', 'merge', '39', '--repo', 'o/n', '--squash', '--match-head-commit', SHA]);
    expect(calls[0]!.args).not.toContain('--delete-branch');
    // No cwd: gh must not touch a local worktree.
    expect(calls[0]!.options?.cwd).toBeUndefined();
  });

  it('propagates gh refusing the merge', async () => {
    const exec: ExecFn = async () => { throw new Error('Head branch was modified. Review and try the merge again.'); };
    const adapter = new GitHubGraphQLAdapter(exec, new FakeLoggerPort());
    await expect(adapter.mergePR({ org: 'o', name: 'n', number: 1, method: 'merge', headSha: SHA }))
      .rejects.toThrow('Head branch was modified');
  });

  it('refuses unsafe input before reaching gh', async () => {
    const { adapter, calls } = makeAdapter(() => '');
    await expect(adapter.mergePR({ org: 'o', name: 'n', number: 1, method: 'admin' as never, headSha: SHA })).rejects.toThrow();
    await expect(adapter.mergePR({ org: 'o', name: 'n', number: 1, method: 'merge', headSha: 'HEAD' })).rejects.toThrow();
    await expect(adapter.mergePR({ org: '-o', name: 'n;rm', number: 1, method: 'merge', headSha: SHA })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

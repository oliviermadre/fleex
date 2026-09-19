import { describe, it, expect } from 'vitest';
import { GitHubGraphQLAdapter } from '../../src/infrastructure/adapters/github-graphql.adapter.js';
import { FakeLoggerPort } from '../helpers/fakes.js';
import type { ExecFn } from '../../src/infrastructure/host/types.js';

describe('GitHubGraphQLAdapter.fetchPRDetails', () => {
  const makeAdapter = (impl: () => string) => {
    const queries: string[] = [];
    const exec: ExecFn = async (_cmd, args) => {
      queries.push(args.find((a) => a.startsWith('query=')) ?? '');
      return { stdout: impl(), stderr: '' };
    };
    return { adapter: new GitHubGraphQLAdapter(exec, new FakeLoggerPort()), queries };
  };

  it('maps every PR GitHub answered to its ref, skipping the ones it did not find', async () => {
    const pr = {
      state: 'OPEN', isDraft: true, title: 'Keycloak scopes', additions: 88, deletions: 4,
      url: 'https://github.com/o/agentic-dmc/pull/12',
    };
    const { adapter, queries } = makeAdapter(() => JSON.stringify({ pr0: { pullRequest: pr }, pr1: { pullRequest: null } }));

    const out = await adapter.fetchPRDetails([
      { org: 'o', name: 'agentic-dmc', number: 12 },
      { org: 'o', name: 'gone', number: 1 },
    ]);

    expect(Object.fromEntries(out)).toEqual({ 'o/agentic-dmc#12': pr });
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain('state isDraft title additions deletions url');
  });

  it('never interpolates an owner or name that is not a plain GitHub identifier', async () => {
    const { adapter, queries } = makeAdapter(() => '{}');
    const out = await adapter.fetchPRDetails([{ org: 'o") { x }', name: 'n', number: 1 }]);
    expect(out.size).toBe(0);
    expect(queries).toEqual([]);
  });

  it('returns an empty map when the GitHub call fails', async () => {
    const { adapter } = makeAdapter(() => {
      throw new Error('gh: rate limited');
    });
    expect((await adapter.fetchPRDetails([{ org: 'o', name: 'n', number: 1 }])).size).toBe(0);
  });
});

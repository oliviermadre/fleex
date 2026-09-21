import { describe, it, expect, vi } from 'vitest';
import { GitHubGraphQLAdapter } from '../../src/infrastructure/adapters/github-graphql.adapter.js';

const makeLogger = () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() });

const emptyRepo = { pullRequests: { totalCount: 0, nodes: [] }, mergedPRs: { nodes: [] }, issues: { totalCount: 0, nodes: [] }, closedIssues: { nodes: [] } };

/** Answers each GraphQL batch with one empty repo per alias in the query, after `delayMs`. */
function makeExec(delayMs: number) {
  let inFlight = 0;
  const stats = { calls: 0, maxInFlight: 0 };
  const execFn = vi.fn(async (_cmd: string, args: string[]) => {
    stats.calls += 1;
    inFlight += 1;
    stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, delayMs));
    inFlight -= 1;
    const query = args.find((a) => a.startsWith('query=')) ?? '';
    const aliases = [...query.matchAll(/(repo\d+): repository/g)].map((m) => m[1]!);
    return { stdout: JSON.stringify(Object.fromEntries(aliases.map((a) => [a, emptyRepo]))), stderr: '', exitCode: 0 };
  });
  return { execFn, stats };
}

describe('GitHubGraphQLAdapter.fetchRepoBatch', () => {
  it('runs its batches of 8 side by side, so 20 repos cost one round-trip and not three', async () => {
    // Every screen that lists PRs across repos waits on this call. Run one batch
    // after the other and the wait grows with the number of configured repos.
    const { execFn, stats } = makeExec(20);
    const adapter = new GitHubGraphQLAdapter(execFn, makeLogger());
    const repos = Array.from({ length: 20 }, (_, i) => ({ org: 'acme', name: `repo-${i}` }));

    const results = await adapter.fetchRepoBatch(repos);

    expect(stats.calls).toBe(3); // 8 + 8 + 4
    expect(stats.maxInFlight).toBe(3);
    expect(results.size).toBe(20);
    expect([...results.keys()]).toEqual(repos.map((r) => `${r.org}/${r.name}`)); // order kept
  });
});

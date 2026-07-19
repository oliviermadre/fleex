# Repos Management Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Settings → Repositories, move repo add/remove into the Repos view, and rebuild the Repos UI (sidebar with search/filters, per-repo Overview dashboard with costs and worktree verdicts, redesigned PRs/Issues tabs, GitHub-driven add modal).

**Architecture:** Incremental in-place transformation of the existing master/detail Repos view (`packages/web`), plus four server additions (`packages/server`): a one-time pattern→explicit-list config migration, a GitHub discovery endpoint, extended issue fetching, and a per-repo cost stats endpoint. Config storage moves from `org/*` patterns to an explicit `owner/repo` list.

**Tech Stack:** React + Zustand + Tailwind v4 (theme vars + `lib/tints.ts`), Fastify (hexagonal), `gh` CLI, Vitest (+ @testing-library/react, jsdom for web).

**Spec:** `docs/superpowers/specs/2026-07-19-repos-refonte-design.md`. Design reference: `../refonte/README.md` + `../refonte/screenshots/` (workspace root, outside the git repo).

## Global Constraints

- **No raw Tailwind palette classes** in `packages/web/src` (`text-orange-400`, …). Decorative color ONLY via `lib/tints.ts` (`tint`, `tintText`, `tintSolid`, `tintClasses`) and `--theme-*` vars. Enforced by `bun run lint` (`scripts/check-raw-palette.mjs`). GitHub label colors (arbitrary hex from API data) are rendered via **inline styles**, never classes.
- **No emoji in the UI.** Icons are inline SVG, strokeWidth 1.2–1.5.
- **UI copy in English** (Overview, Created by me, Clean up, already tracked…).
- **Every destructive action (repo removal, worktree deletion) goes through `ConfirmModal`** — no optimistic delete: on API failure show a toast (the `api.request` helper already toasts) and leave state unchanged.
- All commands run from the repo root: `/Users/oliviermadre/projects/workspaces/9f2303-refonte-de-la-config-et-visualisation-de/fleex`.
- Test: `npx vitest run <file>` (workspace config picks the right package). Full: `bun run test`. Typecheck+palette: `bun run lint`.
- Commit after each task. Message style: `feat(web): …` / `feat(server): …` / `refactor(web): …` / `docs: …`, ending with a blank line then `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- TypeScript strict; workspace imports: web/server import shared types from `@fleex/shared`. Server-internal imports use `.js` extensions.
- **Known spec deviation** (accepted): the "Orphaned worktrees" rows omit the worktree *age* from the prototype — no creation-date data exists client-side and adding one is out of scope. Rows show branch, `↓n` and the Remove button.

---

### Task 1: Extended GitHub issues (shared types + server fetching)

The current `GitHubIssue` has no state/labels/comments and the server only fetches open issues assigned to `@me`. The redesigned Issues tab needs all open issues + recently closed (30 d) with labels and comment counts.

**Files:**
- Modify: `packages/shared/src/types/repository.ts:69-76` (GitHubIssue)
- Modify: `packages/shared/src/types/repository-dashboard.ts:15-25` (RepositoryDashboardData)
- Modify: `packages/server/src/infrastructure/adapters/github-graphql.adapter.ts` (issue query + both mapping sites + `RepoFetchResult`)
- Modify: `packages/server/src/infrastructure/http/repositories.routes.ts:213-247` (issues endpoint) and `:351-426` (dashboard endpoint)
- Modify: any `RepositoryDashboardData` construction site found by `grep -rn "recentlyMergedPullRequests" packages/server/src` (the refresh scheduler builds the same payload)

**Interfaces:**
- Produces (used by Tasks 11, 12):
  ```ts
  export interface GitHubLabel { readonly name: string; readonly color: string; } // color = hex WITHOUT '#'
  export interface GitHubIssue {
    readonly number: number;
    readonly title: string;
    readonly state: 'open' | 'closed';
    readonly author: string;
    readonly assignees: string[];
    readonly labels: GitHubLabel[];
    readonly commentsCount: number;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly closedAt?: string;
  }
  // RepositoryDashboardData gains:
  readonly recentlyClosedIssues: GitHubIssue[];
  ```

- [ ] **Step 1: Update shared types**

In `packages/shared/src/types/repository.ts`, replace the `GitHubIssue` interface with the one above (add `GitHubLabel` just before it). In `repository-dashboard.ts`, add `readonly recentlyClosedIssues: GitHubIssue[];` to `RepositoryDashboardData` after `openIssues`.

- [ ] **Step 2: Update the GraphQL adapter**

In `github-graphql.adapter.ts`:
1. Extend `GraphQLIssueNode` (top of file) with `state: string; closedAt: string | null; labels?: { nodes: { name: string; color: string }[] }; comments?: { totalCount: number };`.
2. In the per-repo query template (~line 229), replace the `issues(...)` block with:
```graphql
issues(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
  totalCount
  nodes {
    number title state closedAt
    author { login }
    assignees(first: 10) { nodes { login } }
    labels(first: 10) { nodes { name color } }
    comments { totalCount }
    createdAt updatedAt
  }
}
closedIssues: issues(first: 20, states: CLOSED, orderBy: {field: UPDATED_AT, direction: DESC}) {
  nodes {
    number title state closedAt
    author { login }
    assignees(first: 10) { nodes { login } }
    labels(first: 10) { nodes { name color } }
    comments { totalCount }
    createdAt updatedAt
  }
}
```
and add `closedIssues: { nodes: GraphQLIssueNode[] }` to `GraphQLRepoResult`.
3. Add one shared mapper near the top of the class file (module scope):
```ts
function mapIssueNode(issue: GraphQLIssueNode): GitHubIssue {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state?.toLowerCase() === 'closed' ? 'closed' : 'open',
    author: issue.author?.login ?? 'unknown',
    assignees: (issue.assignees?.nodes ?? []).map((a) => a.login),
    labels: (issue.labels?.nodes ?? []).map((l) => ({ name: l.name, color: l.color })),
    commentsCount: issue.comments?.totalCount ?? 0,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    ...(issue.closedAt ? { closedAt: issue.closedAt } : {}),
  };
}
```
4. Replace **both** existing `GitHubIssue` mapping sites (`grep -n "issues.nodes.map\|rawIssues.map" …github-graphql.adapter.ts`) with `mapIssueNode`, and compute `closedIssues` filtered to the last 30 days: `const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString(); const closedIssues = repoData.closedIssues.nodes.map(mapIssueNode).filter((i) => i.closedAt && i.closedAt >= thirtyDaysAgo);`.
5. Add `closedIssues: GitHubIssue[]` to `RepoFetchResult` and return it from both fetch paths (the non-batch fallback path can return `[]` if it has no query to get them — check whether it runs the same GraphQL; if it uses `gh issue list`, add `--state closed --search "closed:>…"` symmetry only if trivial, else `[]` with a `// closed issues only via batch path` comment).

- [ ] **Step 3: Update the gh-CLI issues endpoint**

In `repositories.routes.ts` issues endpoint (~line 213): change the `gh issue list` args to
```ts
'--json', 'number,title,state,author,assignees,labels,comments,createdAt,updatedAt,closedAt',
'--state', 'open',
'--limit', '50',
```
(remove `--assignee @me`), update the raw type accordingly (`labels: { name: string; color: string }[]`, `comments: unknown[]`, `state: string`, `closedAt: string | null`) and map:
```ts
return raw.map((issue): GitHubIssue => ({
  number: issue.number,
  title: issue.title,
  state: issue.state?.toLowerCase() === 'closed' ? 'closed' : 'open',
  author: issue.author.login,
  assignees: issue.assignees.map((a) => a.login),
  labels: (issue.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
  commentsCount: Array.isArray(issue.comments) ? issue.comments.length : 0,
  createdAt: issue.createdAt,
  updatedAt: issue.updatedAt,
  ...(issue.closedAt ? { closedAt: issue.closedAt } : {}),
}));
```

- [ ] **Step 4: Thread `recentlyClosedIssues` through the dashboard**

In the dashboard endpoint (~line 351): cache/read `closedIssues:${key}` with `RepositoryCache.TTL_ISSUES`, populate from `result.closedIssues`, and add `recentlyClosedIssues: closedIssues` to the response. Do the same in the refresh-scheduler payload (`grep -rn "recentlyMergedPullRequests" packages/server/src` and mirror). Fix every remaining compile error surfaced by `bun run lint` (constructors of `GitHubIssue` in tests/mocks, if any: `grep -rn "openIssuesCount\|GitHubIssue" packages/server packages/web --include='*.test.*'`).

- [ ] **Step 5: Typecheck + tests + commit**

Run: `bun run lint` → expected: PASS. Run: `bun run test` → expected: PASS (no behavioral test exists on these paths; compile is the gate).
```bash
git add -A && git commit -m "feat(server): extend GitHub issues with state, labels, comments and recently-closed list"
```

---

### Task 2: Config migration — `org/*` patterns → explicit repo list

**Files:**
- Create: `packages/server/src/domain/services/repository-pattern-migration.ts`
- Test: `packages/server/tests/unit/repository-pattern-migration.test.ts`
- Modify: `packages/server/src/main.ts` (after `const container = await createContainer();`, ~line 54)

**Interfaces:**
- Produces: `migrateRepositoryPatterns(config: ConfigPort, resolver: { resolve(patterns: string[]): Promise<string[]> }, logger: LoggerPort): Promise<void>` — idempotent; keeps unresolvable patterns intact.
- Consumes: `ConfigPort.get()/update()` (`packages/server/src/application/ports/config.port.ts`), `RepositoryResolver.resolve` (returns `[]` on gh failure for a wildcard).

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/tests/unit/repository-pattern-migration.test.ts
import { describe, it, expect, vi } from 'vitest';
import { migrateRepositoryPatterns } from '../../src/domain/services/repository-pattern-migration.js';
import type { AppConfig, ConfigPort } from '../../src/application/ports/config.port.js';

function fakeConfig(initial: Partial<AppConfig>): ConfigPort & { updates: Partial<AppConfig>[] } {
  let data: AppConfig = { basePath: '/tmp', defaultShell: '/bin/zsh', repositoryRefreshIntervalMs: 0, ...initial };
  const updates: Partial<AppConfig>[] = [];
  return {
    updates,
    init: async () => {},
    get: () => ({ ...data }),
    update: async (partial) => { updates.push(partial); data = { ...data, ...partial }; },
    getClaudeCommand: () => 'claude',
  };
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

describe('migrateRepositoryPatterns', () => {
  it('is a no-op when no pattern contains a wildcard', async () => {
    const config = fakeConfig({ repositories: ['acme/app', 'acme/lib'] });
    await migrateRepositoryPatterns(config, { resolve: vi.fn() }, logger);
    expect(config.updates).toHaveLength(0);
  });

  it('expands wildcard patterns into an explicit deduped list', async () => {
    const config = fakeConfig({ repositories: ['acme/*', 'other/tool'] });
    const resolver = { resolve: vi.fn(async () => ['acme/app', 'acme/lib', 'other/tool']) };
    await migrateRepositoryPatterns(config, resolver, logger);
    expect(resolver.resolve).toHaveBeenCalledWith(['acme/*']);
    const final = config.get();
    expect(final.repositories).toEqual(['acme/app', 'acme/lib', 'other/tool']);
    expect(final.resolvedRepositories).toEqual(['acme/app', 'acme/lib', 'other/tool']);
    expect(final.resolvedAt).toBeTruthy();
  });

  it('keeps a pattern intact when resolution returns nothing (gh down)', async () => {
    const config = fakeConfig({ repositories: ['acme/*', 'other/tool'] });
    const resolver = { resolve: vi.fn(async () => []) };
    await migrateRepositoryPatterns(config, resolver, logger);
    const final = config.get();
    expect(final.repositories).toEqual(['acme/*', 'other/tool']);
    expect(final.resolvedRepositories).toEqual(['other/tool']);
  });

  it('is idempotent: second run after full expansion does nothing', async () => {
    const config = fakeConfig({ repositories: ['acme/*'] });
    const resolver = { resolve: vi.fn(async () => ['acme/app']) };
    await migrateRepositoryPatterns(config, resolver, logger);
    const countAfterFirst = config.updates.length;
    await migrateRepositoryPatterns(config, resolver, logger);
    expect(config.updates.length).toBe(countAfterFirst);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/unit/repository-pattern-migration.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// packages/server/src/domain/services/repository-pattern-migration.ts
import type { ConfigPort } from '../../application/ports/config.port.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

interface ResolverLike { resolve(patterns: string[]): Promise<string[]>; }

/**
 * One-time (idempotent) migration of `repositories` from wildcard patterns
 * (`org/*`) to an explicit `owner/repo` list. A pattern that cannot be
 * resolved (gh unavailable / empty result) is kept verbatim so nothing is
 * lost — it will be retried on next startup.
 */
export async function migrateRepositoryPatterns(
  config: ConfigPort,
  resolver: ResolverLike,
  logger: LoggerPort,
): Promise<void> {
  const current = config.get().repositories ?? [];
  if (!current.some((p) => p.includes('*'))) return;

  const explicit: string[] = [];
  for (const pattern of current) {
    if (!pattern.includes('*')) {
      explicit.push(pattern.toLowerCase());
      continue;
    }
    const resolved = await resolver.resolve([pattern]);
    if (resolved.length === 0) {
      explicit.push(pattern); // keep — retry next startup
    } else {
      explicit.push(...resolved);
    }
  }

  const repositories = [...new Set(explicit)];
  await config.update({
    repositories,
    resolvedRepositories: repositories.filter((r) => !r.includes('*')),
    resolvedAt: new Date().toISOString(),
  });
  logger.info('Migrated repository patterns to explicit list', {
    before: current.length,
    after: repositories.length,
    remainingPatterns: repositories.filter((r) => r.includes('*')).length,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/server/tests/unit/repository-pattern-migration.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Hook into startup**

In `packages/server/src/main.ts`, right after `const container = await createContainer();` add (import at top with the other infra imports):
```ts
import { migrateRepositoryPatterns } from './domain/services/repository-pattern-migration.js';
// …
migrateRepositoryPatterns(container.config, container.repositoryResolver, container.logger)
  .catch((err) => container.logger.warn('Repository pattern migration failed', { error: String(err) }));
```
Fire-and-forget on purpose: startup must not block on `gh` (15 s timeout per pattern); failure retries next boot.

- [ ] **Step 6: Lint + commit**

Run: `bun run lint` → PASS.
```bash
git add -A && git commit -m "feat(server): migrate repository patterns to explicit repo list at startup"
```

---

### Task 3: GitHub discovery service + endpoints (for the add modal)

**Files:**
- Create: `packages/server/src/domain/services/github-discovery.ts`
- Test: `packages/server/tests/unit/github-discovery.test.ts`
- Modify: `packages/shared/src/types/repository.ts` (discovery types)
- Modify: `packages/server/src/infrastructure/container.ts` (instantiate next to `repositoryResolver` — locate with `grep -n "RepositoryResolver" packages/server/src/infrastructure/container.ts`)
- Modify: `packages/server/src/domain/services/repository-cache.ts` (add `TTL_DISCOVERY`)
- Modify: `packages/server/src/infrastructure/http/repositories.routes.ts` (two routes)

**Interfaces:**
- Produces (used by Tasks 5 and 8):
  ```ts
  // shared/types/repository.ts
  export interface DiscoveredRepo { readonly nameWithOwner: string; readonly visibility: string; readonly updatedAt: string; }
  export interface RepoDiscoveryOwner { readonly login: string; readonly repos: DiscoveredRepo[]; }
  export interface RepoDiscovery { readonly owners: RepoDiscoveryOwner[]; readonly totalRepos: number; }
  ```
  - `GET /api/github/discovery` → `RepoDiscovery` (502 `{error}` when gh unauthenticated)
  - `GET /api/github/verify-repo?repo=owner/repo` → `{ exists: boolean; nameWithOwner?: string }` (400 on malformed input)
  - class `GithubDiscovery { discover(): Promise<RepoDiscovery>; verifyRepo(repo: string): Promise<{ exists: boolean; nameWithOwner?: string }>; }`
- Consumes: `ExecFn` (`packages/server/src/infrastructure/host/types.ts`), `LoggerPort`.

- [ ] **Step 1: Add the shared types** (block above, appended to `repository.ts`).

- [ ] **Step 2: Write the failing test**

```ts
// packages/server/tests/unit/github-discovery.test.ts
import { describe, it, expect, vi } from 'vitest';
import { GithubDiscovery } from '../../src/domain/services/github-discovery.js';

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never;

function execStub(responses: Record<string, string | Error>) {
  return vi.fn(async (_cmd: string, args: string[]) => {
    const key = args.join(' ');
    const match = Object.entries(responses).find(([k]) => key.startsWith(k));
    if (!match) throw new Error(`unexpected gh call: ${key}`);
    if (match[1] instanceof Error) throw match[1];
    return { stdout: match[1] as string, stderr: '' };
  });
}

describe('GithubDiscovery', () => {
  it('aggregates the user and org repos, lowercased', async () => {
    const exec = execStub({
      'api user --jq .login': 'Olivier\n',
      'api user/orgs': 'acme\nBigCorp\n',
      'repo list olivier': JSON.stringify([{ nameWithOwner: 'Olivier/Tool', visibility: 'PRIVATE', updatedAt: '2026-07-01T00:00:00Z' }]),
      'repo list acme': JSON.stringify([{ nameWithOwner: 'acme/app', visibility: 'PUBLIC', updatedAt: '2026-07-02T00:00:00Z' }]),
      'repo list bigcorp': JSON.stringify([]),
    });
    const d = new GithubDiscovery(exec as never, logger);
    const result = await d.discover();
    expect(result.owners.map((o) => o.login)).toEqual(['olivier', 'acme', 'bigcorp']);
    expect(result.owners[0]!.repos[0]).toEqual({ nameWithOwner: 'olivier/tool', visibility: 'private', updatedAt: '2026-07-01T00:00:00Z' });
    expect(result.totalRepos).toBe(2);
  });

  it('tolerates a failing org listing (skips it, keeps the rest)', async () => {
    const exec = execStub({
      'api user --jq .login': 'olivier\n',
      'api user/orgs': 'acme\n',
      'repo list olivier': JSON.stringify([]),
      'repo list acme': new Error('boom'),
    });
    const d = new GithubDiscovery(exec as never, logger);
    const result = await d.discover();
    expect(result.owners.map((o) => o.login)).toEqual(['olivier', 'acme']);
    expect(result.owners[1]!.repos).toEqual([]);
  });

  it('propagates a failure to identify the user (gh not authenticated)', async () => {
    const exec = execStub({ 'api user --jq .login': new Error('gh: not logged in') });
    const d = new GithubDiscovery(exec as never, logger);
    await expect(d.discover()).rejects.toThrow();
  });

  it('verifyRepo returns the canonical name or exists:false', async () => {
    const exec = execStub({
      'repo view anthropics/claude-code': JSON.stringify({ nameWithOwner: 'Anthropics/Claude-Code' }),
      'repo view nope/nope': new Error('not found'),
    });
    const d = new GithubDiscovery(exec as never, logger);
    expect(await d.verifyRepo('anthropics/claude-code')).toEqual({ exists: true, nameWithOwner: 'anthropics/claude-code' });
    expect(await d.verifyRepo('nope/nope')).toEqual({ exists: false });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run packages/server/tests/unit/github-discovery.test.ts` → FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// packages/server/src/domain/services/github-discovery.ts
import type { RepoDiscovery, DiscoveredRepo } from '@fleex/shared';
import type { ExecFn } from '../../infrastructure/host/types.js';
import type { LoggerPort } from '../../application/ports/logger.port.js';

export class GithubDiscovery {
  constructor(private readonly execFn: ExecFn, private readonly logger: LoggerPort) {}

  async discover(): Promise<RepoDiscovery> {
    const { stdout: userOut } = await this.execFn('gh', ['api', 'user', '--jq', '.login'], { timeout: 15_000 });
    const login = userOut.trim().toLowerCase();

    let orgs: string[] = [];
    try {
      const { stdout } = await this.execFn('gh', ['api', 'user/orgs', '--paginate', '--jq', '.[].login'], { timeout: 15_000 });
      orgs = stdout.split('\n').map((s) => s.trim().toLowerCase()).filter(Boolean);
    } catch (err) {
      this.logger.warn('Failed to list GitHub orgs', { error: String(err) });
    }

    const logins = [...new Set([login, ...orgs])];
    const owners = await Promise.all(
      logins.map(async (owner) => {
        try {
          return { login: owner, repos: await this.listRepos(owner) };
        } catch (err) {
          this.logger.warn('Failed to list repos for owner', { owner, error: String(err) });
          return { login: owner, repos: [] };
        }
      }),
    );

    return { owners, totalRepos: owners.reduce((n, o) => n + o.repos.length, 0) };
  }

  async verifyRepo(repo: string): Promise<{ exists: boolean; nameWithOwner?: string }> {
    try {
      const { stdout } = await this.execFn('gh', ['repo', 'view', repo, '--json', 'nameWithOwner'], { timeout: 15_000 });
      const parsed = JSON.parse(stdout) as { nameWithOwner: string };
      return { exists: true, nameWithOwner: parsed.nameWithOwner.toLowerCase() };
    } catch {
      return { exists: false };
    }
  }

  private async listRepos(owner: string): Promise<DiscoveredRepo[]> {
    const { stdout } = await this.execFn('gh', [
      'repo', 'list', owner, '--json', 'nameWithOwner,visibility,updatedAt', '--limit', '200',
    ], { timeout: 20_000 });
    const raw = JSON.parse(stdout) as { nameWithOwner: string; visibility: string; updatedAt: string }[];
    return raw.map((r) => ({
      nameWithOwner: r.nameWithOwner.toLowerCase(),
      visibility: r.visibility.toLowerCase(),
      updatedAt: r.updatedAt,
    }));
  }
}
```
Note the test stubs match on lowercased owner (`repo list olivier`) — listing uses the lowercased login; gh treats owner names case-insensitively.

- [ ] **Step 5: Run test to verify it passes** → PASS (4 tests).

- [ ] **Step 6: Wire container + routes**

1. `container.ts`: add `githubDiscovery: GithubDiscovery` to the Container type and instantiate `new GithubDiscovery(execFn, logger)` next to `repositoryResolver` (mirror its constructor args style).
2. `repository-cache.ts`: add `static readonly TTL_DISCOVERY = 5 * 60 * 1000;` next to the other TTL constants.
3. `repositories.routes.ts`, after the `/api/github/user` route:
```ts
app.get('/api/github/discovery', async (_request, reply) => {
  const cached = container.repositoryCache.get<RepoDiscovery>('github:discovery');
  if (cached) return cached.data;
  try {
    const discovery = await container.githubDiscovery.discover();
    container.repositoryCache.set('github:discovery', discovery, RepositoryCache.TTL_DISCOVERY);
    return discovery;
  } catch (err) {
    container.logger.warn('GitHub discovery failed', { error: String(err) });
    return reply.code(502).send({ error: 'GitHub CLI not authenticated or unavailable' });
  }
});

app.get<{ Querystring: { repo?: string } }>('/api/github/verify-repo', async (request, reply) => {
  const repo = request.query.repo?.trim().toLowerCase() ?? '';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    return reply.code(400).send({ error: 'repo must be owner/repo' });
  }
  return container.githubDiscovery.verifyRepo(repo);
});
```
Add `RepoDiscovery` to the shared-type import at the top of the file.

- [ ] **Step 7: Lint + commit**

Run: `bun run lint` → PASS.
```bash
git add -A && git commit -m "feat(server): GitHub org/repo discovery and repo verification endpoints"
```

---

### Task 4: Per-repo cost stats (use case + endpoint)

**Files:**
- Modify: `packages/shared/src/types/repository.ts` (stats types)
- Create: `packages/server/src/application/use-cases/get-repository-stats.ts`
- Test: `packages/server/tests/unit/get-repository-stats.test.ts`
- Modify: `packages/server/src/infrastructure/http/repositories.routes.ts` (route)

**Interfaces:**
- Produces (used by Tasks 5, 12):
  ```ts
  // shared/types/repository.ts
  export interface RepoDailyCost { readonly date: string; readonly costUsd: number; } // date = YYYY-MM-DD
  export interface RepositoryStats {
    readonly totalCostUsd: number;          // window [now-days, now]
    readonly previousTotalCostUsd: number;  // window [now-2*days, now-days]
    readonly costPerTicketUsd: number;      // total / #tickets with cost in window
    readonly ticketsWithCostCount: number;
    readonly days: number;
    readonly dailyCosts: RepoDailyCost[];   // one entry per day, oldest first, zero-filled
  }
  ```
  - `GET /api/repositories/:org/:name/stats?days=30` → `RepositoryStats`
  - `GetRepositoryStatsUseCase.execute(org: string, name: string, days?: number, now?: Date): Promise<RepositoryStats>`
- Consumes: `TicketStorePort.getTicketsLinkedTo('repository', ref)` (ref = `"org/name"`), `AgentEventStorePort.getExecutionsByTicket(ticketId)` (executions carry `costUsd`, `startedAt`).

- [ ] **Step 1: Add the shared types** (block above).

- [ ] **Step 2: Write the failing test**

```ts
// packages/server/tests/unit/get-repository-stats.test.ts
import { describe, it, expect } from 'vitest';
import { GetRepositoryStatsUseCase } from '../../src/application/use-cases/get-repository-stats.js';

const NOW = new Date('2026-07-19T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86400000).toISOString();

function ticket(id: string, ref: string) {
  return { id, links: [{ type: 'repository', ref }] } as never;
}
function exec(costUsd: number | null, startedAt: string) {
  return { costUsd, startedAt } as never;
}

function makeUseCase(ticketsByRef: Record<string, unknown[]>, execsByTicket: Record<string, unknown[]>) {
  return new GetRepositoryStatsUseCase(
    { getTicketsLinkedTo: async (_type, ref) => (ticketsByRef[ref] ?? []) as never },
    { getExecutionsByTicket: async (id) => (execsByTicket[id] ?? []) as never },
  );
}

describe('GetRepositoryStatsUseCase', () => {
  it('returns zeroed stats for a repo with no linked tickets', async () => {
    const stats = await makeUseCase({}, {}).execute('acme', 'app', 30, NOW);
    expect(stats.totalCostUsd).toBe(0);
    expect(stats.costPerTicketUsd).toBe(0);
    expect(stats.dailyCosts).toHaveLength(30);
    expect(stats.dailyCosts.every((d) => d.costUsd === 0)).toBe(true);
  });

  it('sums costs in the window, buckets per day, and computes the previous window', async () => {
    const stats = await makeUseCase(
      { 'acme/app': [ticket('t1', 'acme/app'), ticket('t2', 'acme/app')] },
      {
        t1: [exec(10, daysAgo(1)), exec(5, daysAgo(1)), exec(100, daysAgo(45))],
        t2: [exec(2.5, daysAgo(10)), exec(null, daysAgo(2))],
      },
    ).execute('acme', 'app', 30, NOW);

    expect(stats.totalCostUsd).toBeCloseTo(17.5);
    expect(stats.previousTotalCostUsd).toBeCloseTo(100);
    expect(stats.ticketsWithCostCount).toBe(2);
    expect(stats.costPerTicketUsd).toBeCloseTo(8.75);
    const yesterday = stats.dailyCosts[stats.dailyCosts.length - 2]!;
    expect(yesterday.costUsd).toBeCloseTo(15);
  });

  it('merges tickets found under the lowercased ref without double-counting', async () => {
    const t = ticket('t1', 'Acme/App');
    const stats = await makeUseCase(
      { 'Acme/App': [t], 'acme/app': [t] },
      { t1: [exec(4, daysAgo(3))] },
    ).execute('Acme', 'App', 30, NOW);
    expect(stats.totalCostUsd).toBeCloseTo(4);
  });
});
```

- [ ] **Step 3: Run test to verify it fails** → FAIL (module not found).

- [ ] **Step 4: Implement**

```ts
// packages/server/src/application/use-cases/get-repository-stats.ts
import type { RepositoryStats, RepoDailyCost } from '@fleex/shared';
import type { TicketStorePort } from '../ports/ticket-store.port.js';
import type { AgentEventStorePort } from '../ports/agent-event-store.port.js';

const DAY_MS = 86_400_000;

type TicketsPort = Pick<TicketStorePort, 'getTicketsLinkedTo'>;
type ExecutionsPort = Pick<AgentEventStorePort, 'getExecutionsByTicket'>;

export class GetRepositoryStatsUseCase {
  constructor(
    private readonly ticketStore: TicketsPort,
    private readonly agentEventStore: ExecutionsPort,
  ) {}

  async execute(org: string, name: string, days = 30, now = new Date()): Promise<RepositoryStats> {
    const ref = `${org}/${name}`;
    const refs = [...new Set([ref, ref.toLowerCase()])];
    const ticketLists = await Promise.all(refs.map((r) => this.ticketStore.getTicketsLinkedTo('repository', r)));
    const tickets = [...new Map(ticketLists.flat().map((t) => [t.id, t])).values()];

    const windowStart = now.getTime() - days * DAY_MS;
    const prevStart = now.getTime() - 2 * days * DAY_MS;

    const dailyCosts: RepoDailyCost[] = Array.from({ length: days }, (_, i) => ({
      date: new Date(windowStart + (i + 1) * DAY_MS).toISOString().slice(0, 10),
      costUsd: 0,
    }));
    const buckets = new Map(dailyCosts.map((d, i) => [d.date, i]));

    let totalCostUsd = 0;
    let previousTotalCostUsd = 0;
    const ticketsWithCost = new Set<string>();

    for (const ticket of tickets) {
      const executions = await this.agentEventStore.getExecutionsByTicket(ticket.id);
      for (const execution of executions) {
        const cost = execution.costUsd ?? 0;
        if (cost <= 0) continue;
        const ts = new Date(execution.startedAt).getTime();
        if (ts >= windowStart && ts <= now.getTime()) {
          totalCostUsd += cost;
          ticketsWithCost.add(ticket.id);
          const idx = buckets.get(new Date(ts).toISOString().slice(0, 10));
          if (idx !== undefined) {
            dailyCosts[idx] = { ...dailyCosts[idx]!, costUsd: dailyCosts[idx]!.costUsd + cost };
          }
        } else if (ts >= prevStart && ts < windowStart) {
          previousTotalCostUsd += cost;
        }
      }
    }

    return {
      totalCostUsd,
      previousTotalCostUsd,
      costPerTicketUsd: ticketsWithCost.size > 0 ? totalCostUsd / ticketsWithCost.size : 0,
      ticketsWithCostCount: ticketsWithCost.size,
      days,
      dailyCosts,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes** → PASS (3 tests).

- [ ] **Step 6: Register the route**

In `repositories.routes.ts`, at the top of `repositoryRoutes` (before `return async function`), instantiate like `statistics.routes.ts` does:
```ts
import { GetRepositoryStatsUseCase } from '../../application/use-cases/get-repository-stats.js';
// inside repositoryRoutes(container):
const getRepositoryStats = new GetRepositoryStatsUseCase(container.ticketStore, container.agentEventStore);
```
and add the route next to the dashboard endpoint:
```ts
app.get<{ Params: { org: string; name: string }; Querystring: { days?: string } }>(
  '/api/repositories/:org/:name/stats',
  async (request) => {
    const { org, name } = request.params;
    const parsed = Number(request.query.days);
    const days = Number.isFinite(parsed) && parsed > 0 && parsed <= 365 ? Math.floor(parsed) : 30;
    return getRepositoryStats.execute(org, name, days);
  },
);
```
(Confirm `container.ticketStore` / `container.agentEventStore` property names via `grep -n "ticketStore\|agentEventStore" packages/server/src/infrastructure/container.ts` — `statistics.routes.ts` already consumes both.)

- [ ] **Step 7: Lint + commit**

Run: `bun run lint` → PASS.
```bash
git add -A && git commit -m "feat(server): per-repo 30-day cost statistics endpoint"
```

---

### Task 5: Web plumbing — API client + store extensions

**Files:**
- Modify: `packages/web/src/services/api.ts`
- Modify: `packages/web/src/stores/settingsStore.ts`
- Modify: `packages/web/src/stores/repositoryDashboardStore.ts`
- Test: `packages/web/src/stores/settingsStore.repos.test.ts`

**Interfaces:**
- Produces (used by Tasks 8, 9, 12):
  ```ts
  // api.ts
  export async function fetchGithubDiscovery(): Promise<RepoDiscovery>
  export async function verifyGithubRepo(repo: string): Promise<{ exists: boolean; nameWithOwner?: string }>
  export async function fetchRepositoryStats(org: string, name: string, days?: number): Promise<RepositoryStats>
  // settingsStore
  addRepositories: (repos: string[]) => Promise<void>   // lowercase, dedupe, sort, saveSettings
  removeRepository: (repo: string) => Promise<void>
  // repositoryDashboardStore
  repoStats: Record<string, RepositoryStats>            // key = "org/name"
  fetchRepoStats: (org: string, name: string) => Promise<void>
  ```
- Consumes: `request<T>` helper in api.ts, `saveSettings` in settingsStore, Task 3/4 endpoints.

- [ ] **Step 1: Write the failing store test**

```ts
// packages/web/src/stores/settingsStore.repos.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from './settingsStore';

describe('settingsStore repository list helpers', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, repositories: ['acme/app'] } }));
  });

  it('addRepositories lowercases, dedupes and sorts', async () => {
    await useSettingsStore.getState().addRepositories(['Acme/Lib', 'acme/app', 'zeta/tool']);
    expect(useSettingsStore.getState().settings.repositories).toEqual(['acme/app', 'acme/lib', 'zeta/tool']);
  });

  it('removeRepository removes case-insensitively', async () => {
    await useSettingsStore.getState().removeRepository('ACME/APP');
    expect(useSettingsStore.getState().settings.repositories).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/web/src/stores/settingsStore.repos.test.ts` → FAIL (`addRepositories` is not a function).

- [ ] **Step 3: Implement**

1. `api.ts` — add the three functions with the other repository functions (~line 235), plus `RepoDiscovery`, `RepositoryStats` in the shared import:
```ts
export async function fetchGithubDiscovery(): Promise<RepoDiscovery> {
  return request('/github/discovery');
}

export async function verifyGithubRepo(repo: string): Promise<{ exists: boolean; nameWithOwner?: string }> {
  return request(`/github/verify-repo?repo=${encodeURIComponent(repo)}`);
}

export async function fetchRepositoryStats(org: string, name: string, days = 30): Promise<RepositoryStats> {
  return request(`/repositories/${org}/${name}/stats?days=${days}`);
}
```
2. `settingsStore.ts` — add to `SettingsState` and implement using the existing `saveSettings`:
```ts
addRepositories: async (repos) => {
  const current = get().settings.repositories;
  const merged = [...new Set([...current.map((r) => r.toLowerCase()), ...repos.map((r) => r.toLowerCase())])].sort();
  await get().saveSettings({ repositories: merged });
},

removeRepository: async (repo) => {
  const target = repo.toLowerCase();
  const filtered = get().settings.repositories.filter((r) => r.toLowerCase() !== target);
  await get().saveSettings({ repositories: filtered });
},
```
3. `repositoryDashboardStore.ts` — add `repoStats: {}` to state, the field to the interface, and:
```ts
fetchRepoStats: async (org, name) => {
  try {
    const stats = await api.fetchRepositoryStats(org, name);
    set((s) => ({ repoStats: { ...s.repoStats, [`${org}/${name}`]: stats } }));
  } catch {
    // ignore — the cost card renders $0 without stats
  }
},
```
(import `RepositoryStats` from `@fleex/shared`).

- [ ] **Step 4: Run test to verify it passes** → PASS (2 tests).

- [ ] **Step 5: Lint + commit**

Run: `bun run lint` → PASS.
```bash
git add -A && git commit -m "feat(web): API client and store plumbing for discovery, repo list edits and repo stats"
```

---

### Task 6: `lib/worktreeVerdict.ts` (pure verdict derivation)

**Files:**
- Create: `packages/web/src/lib/worktreeVerdict.ts`
- Test: `packages/web/src/lib/worktreeVerdict.test.ts`

**Interfaces:**
- Produces (used by Task 12):
  ```ts
  export type WorktreeVerdict = 'ready_to_push' | 'needs_rebase' | 'up_to_date' | 'merged_removable' | 'stale_removable';
  export interface WorktreeVerdictInput {
    commitsAhead: number;
    commitsBehind: number;
    prState?: 'open' | 'merged' | 'closed';
    ticketStatus?: TicketStatus;   // status of the linked ticket, if resolvable
    ticketMissing?: boolean;       // true when no ticket could be linked
  }
  export function deriveWorktreeVerdict(input: WorktreeVerdictInput): WorktreeVerdict
  export function isRemovableVerdict(v: WorktreeVerdict): boolean
  export const VERDICT_META: Record<WorktreeVerdict, { label: string; hue: TintHue }>
  ```
  Labels/hues: `ready_to_push` → "Ready to push"/purple · `needs_rebase` → "Needs rebase"/yellow · `up_to_date` → "Up to date"/gray · `merged_removable` → "Merged · removable"/green · `stale_removable` → "Stale · removable"/red.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/worktreeVerdict.test.ts
import { describe, it, expect } from 'vitest';
import { deriveWorktreeVerdict, isRemovableVerdict, VERDICT_META } from './worktreeVerdict';

const base = { commitsAhead: 0, commitsBehind: 0 };

describe('deriveWorktreeVerdict', () => {
  it('merged PR wins over everything', () => {
    expect(deriveWorktreeVerdict({ ...base, commitsBehind: 5, prState: 'merged', ticketStatus: 'done' })).toBe('merged_removable');
  });
  it('closed/missing ticket → stale (unless merged)', () => {
    expect(deriveWorktreeVerdict({ ...base, ticketStatus: 'done' })).toBe('stale_removable');
    expect(deriveWorktreeVerdict({ ...base, ticketStatus: 'cancelled' })).toBe('stale_removable');
    expect(deriveWorktreeVerdict({ ...base, ticketMissing: true })).toBe('stale_removable');
  });
  it('behind → needs rebase (even when also ahead)', () => {
    expect(deriveWorktreeVerdict({ commitsAhead: 2, commitsBehind: 3, ticketStatus: 'doing' })).toBe('needs_rebase');
  });
  it('ahead only → ready to push', () => {
    expect(deriveWorktreeVerdict({ commitsAhead: 2, commitsBehind: 0, ticketStatus: 'doing', prState: 'open' })).toBe('ready_to_push');
  });
  it('clean → up to date', () => {
    expect(deriveWorktreeVerdict({ ...base, ticketStatus: 'doing' })).toBe('up_to_date');
  });
});

describe('helpers', () => {
  it('isRemovableVerdict flags the two removable states', () => {
    expect(isRemovableVerdict('merged_removable')).toBe(true);
    expect(isRemovableVerdict('stale_removable')).toBe(true);
    expect(isRemovableVerdict('ready_to_push')).toBe(false);
  });
  it('every verdict has a label and a hue', () => {
    for (const meta of Object.values(VERDICT_META)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.hue).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement**

```ts
// packages/web/src/lib/worktreeVerdict.ts
import type { TicketStatus } from '@fleex/shared';
import type { TintHue } from './tints';

export type WorktreeVerdict = 'ready_to_push' | 'needs_rebase' | 'up_to_date' | 'merged_removable' | 'stale_removable';

export interface WorktreeVerdictInput {
  commitsAhead: number;
  commitsBehind: number;
  prState?: 'open' | 'merged' | 'closed';
  ticketStatus?: TicketStatus;
  ticketMissing?: boolean;
}

const CLOSED_TICKET_STATUSES: TicketStatus[] = ['done', 'cancelled'];

export function deriveWorktreeVerdict(input: WorktreeVerdictInput): WorktreeVerdict {
  if (input.prState === 'merged') return 'merged_removable';
  if (input.ticketMissing || (input.ticketStatus && CLOSED_TICKET_STATUSES.includes(input.ticketStatus))) {
    return 'stale_removable';
  }
  if (input.commitsBehind > 0) return 'needs_rebase';
  if (input.commitsAhead > 0) return 'ready_to_push';
  return 'up_to_date';
}

export function isRemovableVerdict(v: WorktreeVerdict): boolean {
  return v === 'merged_removable' || v === 'stale_removable';
}

export const VERDICT_META: Record<WorktreeVerdict, { label: string; hue: TintHue }> = {
  ready_to_push: { label: 'Ready to push', hue: 'purple' },
  needs_rebase: { label: 'Needs rebase', hue: 'yellow' },
  up_to_date: { label: 'Up to date', hue: 'gray' },
  merged_removable: { label: 'Merged · removable', hue: 'green' },
  stale_removable: { label: 'Stale · removable', hue: 'red' },
};
```

- [ ] **Step 4: Run test to verify it passes** → PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/worktreeVerdict.ts packages/web/src/lib/worktreeVerdict.test.ts
git commit -m "feat(web): worktree verdict derivation"
```

---

### Task 7: `ConfirmModal` UI component

**Files:**
- Create: `packages/web/src/components/ui/ConfirmModal.tsx`
- Test: `packages/web/src/components/ui/ConfirmModal.test.tsx`

**Interfaces:**
- Produces (used by Tasks 9, 11, 12):
  ```tsx
  interface ConfirmModalProps {
    open: boolean;
    title: string;
    message: React.ReactNode;
    confirmLabel?: string;   // default 'Confirm'
    danger?: boolean;        // default true → danger Button
    busy?: boolean;          // disables buttons while the action runs
    onConfirm: () => void;
    onCancel: () => void;
  }
  export function ConfirmModal(props: ConfirmModalProps)
  ```
- Consumes: `ui/Modal.tsx` (`open`, `onClose`, `maxWidth`), `ui/Button.tsx` (`variant: 'danger' | 'secondary'`).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/ui/ConfirmModal.test.tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmModal } from './ConfirmModal';

afterEach(cleanup);

describe('ConfirmModal', () => {
  it('renders nothing when closed', () => {
    render(<ConfirmModal open={false} title="Remove repo" message="Sure?" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.queryByText('Remove repo')).toBeNull();
  });

  it('calls onConfirm / onCancel', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmModal open title="Remove repo" message="Sure?" confirmLabel="Remove" onConfirm={onConfirm} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('Remove'));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('disables both buttons while busy', () => {
    render(<ConfirmModal open busy title="t" message="m" confirmLabel="Remove" onConfirm={() => {}} onCancel={() => {}} />);
    expect((screen.getByText('Remove') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText('Cancel') as HTMLButtonElement).disabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement**

```tsx
// packages/web/src/components/ui/ConfirmModal.tsx
import { Modal } from './Modal';
import { Button } from './Button';

interface ConfirmModalProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  open, title, message, confirmLabel = 'Confirm', danger = true, busy = false, onConfirm, onCancel,
}: ConfirmModalProps) {
  return (
    <Modal open={open} onClose={onCancel} maxWidth="max-w-sm">
      <h2 className="text-sm font-semibold text-[var(--theme-text-primary)]">{title}</h2>
      <div className="mt-2 text-xs text-[var(--theme-text-secondary)]">{message}</div>
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} size="sm" disabled={busy} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/ui/ConfirmModal.tsx packages/web/src/components/ui/ConfirmModal.test.tsx
git commit -m "feat(web): ConfirmModal primitive"
```

---

### Task 8: `AddRepositoriesModal`

**Files:**
- Create: `packages/web/src/components/repositories/AddRepositoriesModal.tsx`
- Test: `packages/web/src/components/repositories/AddRepositoriesModal.test.tsx`

**Interfaces:**
- Produces (used by Task 9): `export function AddRepositoriesModal({ open, onClose }: { open: boolean; onClose: () => void })`
- Consumes: `api.fetchGithubDiscovery`, `api.verifyGithubRepo` (Task 5), `useSettingsStore` (`settings.repositories`, `addRepositories`), `ui/Modal`, `ui/Button`.

Behavior (from mockup `05-modal-ajout.png` / prototype):
- Header: "Add repositories" + subtitle "Organizations detected via `gh` — {owners} orgs, {totalRepos} accessible repos".
- Live search input filtering repos by `nameWithOwner` (case-insensitive) + result count on the right.
- One group per owner: header `OWNER` + "{tracked}/{total} tracked" + right-aligned link "Select all · `owner/*`" (adds every not-yet-tracked, not-yet-selected repo of that owner to the selection).
- Repo row: mono name, meta "{visibility} · updated {relative}", right side: if already tracked → text badge "already tracked" + disabled toggle ON; else a toggle bound to the selection set. Selected rows get accent-tinted bg/border.
- Footer free-form: label "Repo outside your organizations? Enter its full name", input placeholder `owner/repo — e.g. anthropics/claude-code`, button "Verify & add" enabled only when `/^[\w.-]+\/[\w.-]+$/` matches; on click → `verifyGithubRepo`; if exists → add `nameWithOwner` to selection + clear input; if already tracked → inline "already tracked" hint; if not → inline "Repository not found".
- Footer bar: left recap "{n} repos to add · name1, name2, +k more" (or "Select repos to track" when 0); right: Cancel + primary "Add {n} repos" disabled at 0. Submit → `await addRepositories([...selection])` → reset selection → `onClose()`.
- Loading state while discovery loads; error state ("GitHub CLI not authenticated or unavailable" + Retry button) when it rejects.
- Uses `Modal` with `maxWidth="max-w-3xl"`; list area `max-h-[50vh] overflow-y-auto`.

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/repositories/AddRepositoriesModal.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AddRepositoriesModal } from './AddRepositoriesModal';
import { useSettingsStore } from '../../stores/settingsStore';
import * as api from '../../services/api';

vi.mock('../../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/api')>()),
  fetchGithubDiscovery: vi.fn(),
  verifyGithubRepo: vi.fn(),
}));

const discovery = {
  owners: [
    { login: 'acme', repos: [
      { nameWithOwner: 'acme/app', visibility: 'private', updatedAt: '2026-07-18T00:00:00Z' },
      { nameWithOwner: 'acme/lib', visibility: 'public', updatedAt: '2026-07-01T00:00:00Z' },
    ] },
  ],
  totalRepos: 2,
};

describe('AddRepositoriesModal', () => {
  beforeEach(() => {
    vi.mocked(api.fetchGithubDiscovery).mockResolvedValue(discovery);
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, repositories: ['acme/app'] } }));
  });
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('marks tracked repos and lets you select the rest', async () => {
    render(<AddRepositoriesModal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('acme/lib')).toBeTruthy());
    expect(screen.getByText('already tracked')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: /acme\/lib/i }));
    expect(screen.getByText('Add 1 repo')).toBeTruthy();
  });

  it('submits the selection through addRepositories', async () => {
    const addRepositories = vi.fn(async () => {});
    useSettingsStore.setState({ addRepositories } as never);
    const onClose = vi.fn();
    render(<AddRepositoriesModal open onClose={onClose} />);
    await waitFor(() => screen.getByText('acme/lib'));
    fireEvent.click(screen.getByRole('switch', { name: /acme\/lib/i }));
    fireEvent.click(screen.getByText('Add 1 repo'));
    await waitFor(() => expect(addRepositories).toHaveBeenCalledWith(['acme/lib']));
    expect(onClose).toHaveBeenCalled();
  });

  it('gates the free-form flow on format then existence', async () => {
    vi.mocked(api.verifyGithubRepo).mockResolvedValue({ exists: false });
    render(<AddRepositoriesModal open onClose={() => {}} />);
    await waitFor(() => screen.getByText('acme/lib'));
    const input = screen.getByPlaceholderText(/owner\/repo/i);
    const verify = screen.getByText('Verify & add') as HTMLButtonElement;
    expect(verify.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'anthropics/claude-code' } });
    expect(verify.disabled).toBe(false);
    fireEvent.click(verify);
    await waitFor(() => expect(screen.getByText('Repository not found')).toBeTruthy());
  });

  it('shows the error state when discovery fails', async () => {
    vi.mocked(api.fetchGithubDiscovery).mockRejectedValue(new Error('502'));
    render(<AddRepositoriesModal open onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/not authenticated or unavailable/i)).toBeTruthy());
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement**

Full component (~230 lines). Key structure — implement exactly this shape, styling with theme vars/tints:

```tsx
// packages/web/src/components/repositories/AddRepositoriesModal.tsx
import { useState, useEffect, useMemo, useCallback } from 'react';
import type { RepoDiscovery } from '@fleex/shared';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { useSettingsStore } from '../../stores/settingsStore';
import * as api from '../../services/api';
import { cn } from '../../lib/cn';
import { tintClasses, tintText } from '../../lib/tints';

const REPO_RE = /^[\w.-]+\/[\w.-]+$/;

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 30) return `${Math.floor(days / 30)}mo ago`;
  if (days > 0) return `${days}d ago`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h ago`;
  return `${Math.floor(diff / 60000)}m ago`;
}

function Toggle({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange?: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative h-[19px] w-[34px] rounded-full transition-colors',
        on ? 'bg-[var(--theme-accent)]' : 'bg-[var(--theme-bg-overlay)]',
        disabled && 'cursor-not-allowed opacity-50',
      )}
    >
      <span className={cn(
        'absolute top-[2.5px] h-[14px] w-[14px] rounded-full bg-white transition-[left] duration-150',
        on ? 'left-[17px]' : 'left-[3px]',
      )} />
    </button>
  );
}

export function AddRepositoriesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const tracked = useSettingsStore((s) => s.settings.repositories);
  const addRepositories = useSettingsStore((s) => s.addRepositories);
  const trackedSet = useMemo(() => new Set(tracked.map((r) => r.toLowerCase())), [tracked]);

  const [discovery, setDiscovery] = useState<RepoDiscovery | null>(null);
  const [discoveryError, setDiscoveryError] = useState(false);
  const [query, setQuery] = useState('');
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [freeform, setFreeform] = useState('');
  const [freeformHint, setFreeformHint] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const loadDiscovery = useCallback(() => {
    setDiscoveryError(false);
    api.fetchGithubDiscovery().then(setDiscovery).catch(() => setDiscoveryError(true));
  }, []);

  useEffect(() => {
    if (open) { loadDiscovery(); setSelection(new Set()); setQuery(''); setFreeform(''); setFreeformHint(null); }
  }, [open, loadDiscovery]);

  // filtered owners (query on nameWithOwner), toggle/selectAll/handleVerify/handleSubmit …
  // …full JSX per the Behavior list above…
}
```
Implementation notes:
- `toggle(repo)`: new Set, add/delete; ignore tracked repos.
- `selectAll(owner)`: add every `repo.nameWithOwner` of that owner not in `trackedSet`.
- `handleVerify`: `setVerifying(true)`; `verifyGithubRepo(freeform.toLowerCase())`; on `exists` → if `trackedSet.has(nameWithOwner)` → `setFreeformHint('already tracked')` else add to selection + `setFreeform('')` + clear hint; on `!exists` → `setFreeformHint('Repository not found')`; finally `setVerifying(false)`. Free-form repos not present in discovery render in the footer recap only.
- `handleSubmit`: `setSubmitting(true)`; `await addRepositories([...selection])`; `onClose()`; `setSubmitting(false)`. Button label: `Add ${n} repo${n === 1 ? '' : 's'}`.
- Recap: `[...selection].slice(0, 3).join(', ')` + `+${n - 3} more` when longer.
- Selected row classes: `cn('…base row…', selected && cn('border', tintClasses('purple').borderColor, tintClasses('purple').bg))`; "already tracked" badge: `tintText('green')`.
- Error state: message + `<Button size="sm" onClick={loadDiscovery}>Retry</Button>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run packages/web/src/components/repositories/AddRepositoriesModal.test.tsx` → PASS (4 tests).

- [ ] **Step 5: Lint + commit**

Run: `bun run lint` → PASS.
```bash
git add -A && git commit -m "feat(web): add-repositories modal driven by GitHub discovery"
```

---

### Task 9: Sidebar redesign (search, filter chips, ACTIVE section, add/remove)

**Files:**
- Modify: `packages/web/src/components/sidebar/RepositoriesContent.tsx` (full rewrite)
- Modify: `packages/web/src/components/sidebar/RepoItem.tsx` (two-line layout + wt badge + trash)
- Modify: `packages/web/src/components/sidebar/OrgGroup.tsx` (pass-through props)
- Modify: `packages/web/src/components/sidebar/RepositoriesSidebarHeader.tsx` (add `+` button)

**Interfaces:**
- Consumes: `AddRepositoriesModal` (Task 8), `ConfirmModal` (Task 7), `useSettingsStore().removeRepository` (Task 5), `useSessionStore((s) => s.sessionGroups)` (`SessionGroup { repositoryOrg, repositoryName, worktrees: WorktreeSessionGroup[] }`).
- Produces: new props —
  ```ts
  // RepoItem
  interface Props { summary: RepositorySummary; wtCount: number; onRemove: (key: string) => void; }
  // OrgGroup
  interface Props { org: string; repos: RepositorySummary[]; wtCounts: Record<string, number>; onRemove: (key: string) => void; }
  // RepositoriesSidebarHeader
  interface Props { onAdd: () => void; }
  ```

- [ ] **Step 1: RepositoriesContent rewrite**

State: `const [query, setQuery] = useState(''); const [filter, setFilter] = useState<'all' | 'active' | string>('all'); const [modalOpen, setModalOpen] = useState(false); const [pendingRemove, setPendingRemove] = useState<string | null>(null); const [removing, setRemoving] = useState(false);`

Derived data:
```tsx
const sessionGroups = useSessionStore((s) => s.sessionGroups);
const removeRepository = useSettingsStore((s) => s.removeRepository);

const wtCounts = useMemo(() => {
  const counts: Record<string, number> = {};
  for (const g of sessionGroups) {
    counts[`${g.repositoryOrg}/${g.repositoryName}`] = g.worktrees.length;
  }
  return counts;
}, [sessionGroups]);

const activeKeys = useMemo(() => {
  const keys = new Set<string>();
  for (const g of sessionGroups) {
    if (g.worktrees.length > 0 || g.worktrees.some((w) => w.sessions.length > 0)) {
      keys.add(`${g.repositoryOrg}/${g.repositoryName}`);
    }
  }
  return keys;
}, [sessionGroups]);
```
Filtering: start from `Object.values(summaries)`; apply `query` on `name` and `org/name` (case-insensitive); apply `filter` (`'active'` → key in `activeKeys`; an org string → `summary.org === filter`). Org chips = sorted distinct orgs with their counts; chips render `All {total}`, `Active {activeKeys.size}`, then one per org. Chip classes: active → `bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]`; inactive → `bg-[var(--theme-bg-overlay)] text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]`; both `rounded-full px-3 py-0.5 text-[11px]`.

Layout (top to bottom): `<RepositoriesSidebarHeader onAdd={() => setModalOpen(true)} />`, search input (`w-full rounded-lg border border-[var(--theme-border)] bg-[var(--theme-bg-primary)] px-3 py-2 text-xs …` in a `px-3 pt-3` wrapper, with an inline magnifier SVG), chips row (`flex flex-wrap gap-1.5 px-3 py-2`), then the scrollable list:
- When `query === '' && filter === 'all'`: an **ACTIVE** section first — label `<div className={cn('px-4 pt-3 pb-1 text-[11px] font-bold uppercase tracking-wider', tintText('yellow'))}>Active</div>` followed by `RepoItem`s for `activeKeys` (sorted), then the org groups (each org's full list, unchanged ordering).
- Otherwise: flat org groups over the filtered list (no ACTIVE section).
- Empty tracked list: dashed-border `+` icon, "No repositories tracked yet", `<Button variant="primary" size="sm" onClick={() => setModalOpen(true)}>+ Add repositories</Button>` — **the "Configure repositories in Settings" copy is deleted**.
- Empty filter result: "No repos match" muted line.

Removal flow: `onRemove={(key) => setPendingRemove(key)}` threaded to items; render
```tsx
<ConfirmModal
  open={pendingRemove !== null}
  busy={removing}
  title="Stop tracking repository"
  message={<span>Remove <span className="font-mono">{pendingRemove}</span> from tracked repositories? Its local bare clone will be cleaned up.</span>}
  confirmLabel="Remove"
  onCancel={() => setPendingRemove(null)}
  onConfirm={async () => {
    if (!pendingRemove) return;
    setRemoving(true);
    try { await removeRepository(pendingRemove); } finally { setRemoving(false); setPendingRemove(null); }
  }}
/>
<AddRepositoriesModal open={modalOpen} onClose={() => setModalOpen(false)} />
```

- [ ] **Step 2: RepoItem two-line layout**

Replace the five `BadgeIcon` counters (delete `BadgeIcon`, `CircleDotIcon`, `GitPullRequestArrowIcon`, `UserCheckIcon`, `GitPullRequestIcon`, `GitMergeIcon`) with:
- Line 1: git-branch SVG (20px, strokeWidth 1.5, `text-[var(--theme-text-muted)]`, selected → `text-[var(--theme-accent)]`) + `summary.name` (`text-sm font-semibold`), then `ml-auto`: `wtCount > 0` badge `<span className="rounded-md border border-[var(--theme-border)] bg-[var(--theme-bg-overlay)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--theme-text-muted)]">{wtCount} wt</span>`, the existing not-cloned `CloudDownloadIcon` (keep), and a trash button:
```tsx
<button
  className={cn('ml-1 flex-shrink-0 rounded p-0.5 opacity-25 transition-opacity group-hover:opacity-100', tintText('red'), 'hover:bg-[var(--tint-red-bg)]')}
  title="Stop tracking this repo"
  onClick={(e) => { e.stopPropagation(); onRemove(key); }}
>
  <TrashIcon />
</button>
```
with `function TrashIcon()` = 12px SVG (lid + can, strokeWidth 1.5). Keep the GitHub + scratchpad hover icons.
- Line 2: `<span className="truncate font-mono text-[11px] text-[var(--theme-text-muted)]">{key}</span>`.
- The root stays a `button` with the same selected/border-left treatment. Note: nested interactive elements — use `<span role="button">` (as the existing scratchpad affordance does) for the trash if the nesting warns.

- [ ] **Step 3: OrgGroup + header**

`OrgGroup`: accept and forward `wtCounts`/`onRemove` to `RepoItem` (`wtCount={wtCounts[`${repo.org}/${repo.name}`] ?? 0}`). Highlight the org of the selected repo: `useUIStore((s) => s.selectedRepoKey)`, if `selectedRepoKey?.startsWith(org + '/')` add `text-[var(--theme-accent)]` on the label.

`RepositoriesSidebarHeader`: add prop `onAdd: () => void`; render before `RefreshControl`:
```tsx
<button
  onClick={onAdd}
  title="Add repositories"
  className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--theme-accent)] text-[var(--theme-accent-fg)] hover:opacity-90"
>
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M8 3v10M3 8h10" /></svg>
</button>
```

- [ ] **Step 4: Verify**

Run: `bun run lint` → PASS. Run: `bun run test` → PASS. Launch `bun run dev` and visually check: search filters live, chips filter, ACTIVE section lists repos with worktrees, `+` opens the modal, trash asks confirmation then removes (repo disappears from sidebar).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(web): redesigned repositories sidebar with search, filters and inline add/remove"
```

---

### Task 10: Pull Requests tab — segments, "me" toggles, card rows, merged cleanup

**Files:**
- Create: `packages/web/src/components/repository-dashboard/prFilters.ts`
- Test: `packages/web/src/components/repository-dashboard/prFilters.test.ts`
- Modify: `packages/web/src/components/repository-dashboard/PullRequestsSection.tsx` (rewrite)
- Delete: `packages/web/src/components/repository-dashboard/MergedPRsSection.tsx`

**Interfaces:**
- Produces:
  ```ts
  // prFilters.ts
  export type PrSegment = 'all' | 'open' | 'merged';
  export function filterPulls(open: PullRequest[], merged: PullRequest[], segment: PrSegment, mine: boolean, assigned: boolean, user: string | null): PullRequest[]
  // PullRequestsSection new props (consumed by Task 12's wiring)
  interface Props {
    org: string; name: string;
    openPRs: PullRequest[]; mergedPRs: PullRequest[];
    worktrees: Worktree[]; diffStats: Record<string, DiffStats>;
    githubUser: string | null; loading: boolean;
  }
  ```
- Consumes: `ConfirmModal`, `api.deleteWorktree(org, name, path)`, `useTicketActivityStore((s) => s.costByTicket)`, existing `SmartSessionButton` / `ImportTaskButton` / `DiffStatsBadge` / `findSessionsForTicketId`, ticket-by-PR mapping via `ticket.links` (`type === 'github_pr'`, `ref === "org/name#number"`).

- [ ] **Step 1: Write the failing filter test**

```ts
// packages/web/src/components/repository-dashboard/prFilters.test.ts
import { describe, it, expect } from 'vitest';
import { filterPulls } from './prFilters';
import type { PullRequest } from '@fleex/shared';

function pr(number: number, over: Partial<PullRequest> = {}): PullRequest {
  return {
    number, title: `PR ${number}`, headRefName: `b${number}`, state: 'open',
    author: 'alice', assignees: [], createdAt: '2026-07-01T00:00:00Z', updatedAt: `2026-07-${String(10 + number).padStart(2, '0')}T00:00:00Z`,
    ...over,
  };
}

const open = [pr(1), pr(2, { author: 'bob', assignees: ['alice'] })];
const merged = [pr(3, { state: 'merged', mergedAt: '2026-07-15T00:00:00Z', author: 'alice' })];

describe('filterPulls', () => {
  it('segment open / merged / all', () => {
    expect(filterPulls(open, merged, 'open', false, false, null).map((p) => p.number)).toEqual([2, 1]);
    expect(filterPulls(open, merged, 'merged', false, false, null).map((p) => p.number)).toEqual([3]);
    expect(filterPulls(open, merged, 'all', false, false, null)).toHaveLength(3);
  });
  it('sorts all by updatedAt desc', () => {
    // factory dates: pr1 → 2026-07-11, pr2 → 2026-07-12, pr3 → 2026-07-13
    expect(filterPulls(open, merged, 'all', false, false, null).map((p) => p.number)).toEqual([3, 2, 1]);
  });
  it('mine AND assigned combine with AND', () => {
    expect(filterPulls(open, merged, 'all', true, false, 'alice').map((p) => p.number)).toEqual([3, 1]);
    expect(filterPulls(open, merged, 'all', false, true, 'alice').map((p) => p.number)).toEqual([2]);
    expect(filterPulls(open, merged, 'all', true, true, 'alice')).toEqual([]);
  });
  it('ignores the toggles when the user is unknown', () => {
    expect(filterPulls(open, merged, 'all', true, true, null)).toHaveLength(3);
  });
});
```
- [ ] **Step 2: Run test to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement `prFilters.ts`**

```ts
import type { PullRequest } from '@fleex/shared';

export type PrSegment = 'all' | 'open' | 'merged';

export function filterPulls(
  open: PullRequest[],
  merged: PullRequest[],
  segment: PrSegment,
  mine: boolean,
  assigned: boolean,
  user: string | null,
): PullRequest[] {
  let base: PullRequest[];
  if (segment === 'open') {
    base = [...open].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  } else if (segment === 'merged') {
    base = [...merged].sort((a, b) => (b.mergedAt ?? b.updatedAt).localeCompare(a.mergedAt ?? a.updatedAt));
  } else {
    base = [...open, ...merged].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  if (user && mine) base = base.filter((p) => p.author === user);
  if (user && assigned) base = base.filter((p) => p.assignees.includes(user));
  return base;
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS.

- [ ] **Step 5: Rewrite `PullRequestsSection`**

Drop `DataTable`; keep the import-PR flow (`handleImportPR`, `ticketByPR`) as-is. New render:

1. **Control bar** (`flex items-center gap-3`):
   - Segmented control: container `flex rounded-lg bg-[var(--theme-bg-primary)] p-0.5 border border-[var(--theme-border)]`; three buttons `All {open.length + merged.length}` / `Open {open.length}` / `Merged {merged.length}`; active → `rounded-md bg-[var(--theme-accent)] text-[var(--theme-accent-fg)]`, inactive → `text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)]`; all `px-3 py-1 text-xs`.
   - Vertical divider `h-4 w-px bg-[var(--theme-border)]`.
   - Two toggle chips "Created by me" / "Assigned to me": active → `cn('border', tintClasses('purple').borderColor, tintClasses('purple').bg, tintClasses('purple').text)` with a leading `✓`-shaped SVG check (10px polyline); inactive → `border border-[var(--theme-border)] text-[var(--theme-text-muted)]`; both `rounded-full px-3 py-1 text-xs`.
2. **Result line**: `text-[11px] text-[var(--theme-text-faint)]` — `{segmentLabel}{mine ? ' · created by me' : ''}{assigned ? ' · assigned to me' : ''} — {filtered.length} pull requests` where segmentLabel = 'All' | 'Open' | 'Merged'.
3. **Rows** — `filtered = filterPulls(openPRs, mergedPRs, segment, mine, assigned, githubUser)`, each rendered as a card `rounded-[11px] border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-5 py-4 hover:bg-[var(--theme-bg-hover)]`, `flex items-center gap-4`:
   - Left block (grow, min-w-0): line 1 `#num` mono muted + title `text-sm font-semibold truncate` (click on title area opens the PR on GitHub — keep the `window.open` behavior); line 2 `font-mono text-[11px] text-[var(--theme-text-muted)]` branch + ` · {author} · {formatRelativeTime(updatedAt)}` — for merged rows instead: `merged {formatRelativeTime(mergedAt ?? updatedAt)} ago · {worktreeGone ? 'worktree cleaned' : 'worktree still present'}` with the "still present" span in `tintText('red')`.
   - `DiffStatsBadge stats={diffStats[row.headRefName]}` (open rows only).
   - Ticket chip when linked: `<button onClick={() => navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`)} className={cn('flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-[10.5px]', tintClasses('purple').solid, tintClasses('purple').onSolid)}>ticket #{ticket.displayId}<span className="rounded bg-white/20 px-1 text-[9.5px]">{ticket.status}</span></button>` (import `useNavigate` from react-router-dom). Cost chip on merged rows when `costByTicket[ticket.id]`: `cn('rounded-md px-1.5 py-0.5 font-mono text-[10.5px]', tintClasses('pink').bg, tintClasses('pink').text)` with `${cost.toFixed(2)}` prefixed by `$`.
   - Right action: open rows → existing `ImportTaskButton` / `SmartSessionButton` branch, unchanged. Merged rows with `worktrees.some((wt) => wt.branch === row.headRefName)` → `<Button variant="danger" size="sm" onClick={() => setCleanupTarget(row.headRefName)}>Clean up</Button>`; merged rows already clean → `<Button variant="ghost" size="sm" onClick={() => window.open(prUrl, '_blank')}>Open</Button>`.
   - Merged rows with a lingering worktree also get `cn('border', tintClasses('red').borderColor)` on the card.
4. **Cleanup confirm**: local state `cleanupTarget: string | null`; `ConfirmModal` (title "Delete worktree", message shows the branch + path, confirm "Delete") whose confirm handler finds `worktrees.find((wt) => wt.branch === cleanupTarget)`, calls `await api.deleteWorktree(org, name, wt.path)` then `await fetchDashboard(org, name)`.
5. Empty state: "No pull requests match" muted; keep the `loading` skeleton behavior simple (`loading && filtered.length === 0` → three pulse-animated placeholder cards).

Delete `MergedPRsSection.tsx` (`git rm`). `RepositoryDashboard` still references it — it compiles again in Task 12; to keep this task green, update the call sites in `RepositoryDashboard.tsx` minimally now: remove the `merged` tab entry + `MergedPRsSection` import/render, and pass the new props to `PullRequestsSection` (`openPRs={openPRs} mergedPRs={mergedPRs} worktrees={data?.worktrees ?? []}`).

- [ ] **Step 6: Verify + commit**

Run: `npx vitest run packages/web/src/components/repository-dashboard/prFilters.test.ts` → PASS. Run: `bun run lint` → PASS. Run: `bun run test` → PASS. Visual check in `bun run dev`: segments switch, toggles AND-combine, merged rows show cleanup state.
```bash
git add -A && git commit -m "feat(web): PR tab with state segments, me-filters and merged worktree cleanup"
```

---

### Task 11: Issues tab — segments + labels

**Files:**
- Create: `packages/web/src/components/repository-dashboard/IssuesSection.tsx`
- Delete: `packages/web/src/components/repository-dashboard/IssuesBanner.tsx`
- Modify: `packages/web/src/components/repository-dashboard/RepositoryDashboard.tsx` (swap import; full tab rework lands in Task 12)

**Interfaces:**
- Produces: `export function IssuesSection({ org, name, openIssues, closedIssues, loading }: { org: string; name: string; openIssues: GitHubIssue[]; closedIssues: GitHubIssue[]; loading: boolean })`
- Consumes: extended `GitHubIssue` (Task 1: `state`, `labels`, `commentsCount`), `dashboardData.recentlyClosedIssues`, existing `ImportTaskButton`/`SmartSessionButton` flow (copy the `ticketByIssue` / `handleImportIssue` logic from `IssuesBanner` verbatim).

- [ ] **Step 1: Implement `IssuesSection`**

Same grammar as Task 10 (reuse literally the same segmented-control classes): segments `All / Open / Closed`, no "me" toggles, result line `{segmentLabel} — {n} issues`. Base list: `open` → `openIssues`, `closed` → `closedIssues`, `all` → both; sort by `updatedAt` desc.

Row card (same card classes as PR rows): line 1 `#num` mono + title `text-sm font-semibold truncate` + label chips; line 2 `{author} · {formatRelativeTime(createdAt)} ago{commentsCount > 0 ? ` · ${commentsCount} comment${commentsCount === 1 ? '' : 's'}` : ''}` in `text-[11px] text-[var(--theme-text-muted)]`. Closed issues get a muted title (`text-[var(--theme-text-secondary)]`).

Label chip — GitHub colors are arbitrary API hex, so inline styles (never palette classes):
```tsx
function LabelChip({ label }: { label: GitHubLabel }) {
  const color = `#${label.color}`;
  return (
    <span
      className="rounded-full border px-2 py-0.5 text-[10.5px] leading-none"
      style={{ color, backgroundColor: `${color}1A`, borderColor: `${color}55` }}
    >
      {label.name}
    </span>
  );
}
```
Right action: identical branch to the old `IssuesBanner` (`ImportTaskButton` when no linked ticket, else `SmartSessionButton`); on closed issues without ticket, show the ghost "Open" button (GitHub link) instead of Import. Row click opens the issue on GitHub.

- [ ] **Step 2: Swap the usage**

In `RepositoryDashboard.tsx`: replace the `IssuesBanner` import/render with `IssuesSection` passing `openIssues={issues} closedIssues={data?.recentlyClosedIssues ?? []}`. `git rm packages/web/src/components/repository-dashboard/IssuesBanner.tsx`.

- [ ] **Step 3: Verify + commit**

Run: `bun run lint` → PASS. Run: `bun run test` → PASS. Visual check: segments, label chips with GitHub colors, comment counts.
```bash
git add -A && git commit -m "feat(web): issues tab with state segments and GitHub labels"
```

---

### Task 12: Overview tab + tab wiring + header badge

**Files:**
- Create: `packages/web/src/components/repository-dashboard/overview-helpers.ts`
- Test: `packages/web/src/components/repository-dashboard/overview-helpers.test.ts`
- Create: `packages/web/src/components/repository-dashboard/Sparkline.tsx`
- Create: `packages/web/src/components/repository-dashboard/TicketsWorktreesPanel.tsx`
- Create: `packages/web/src/components/repository-dashboard/OverviewTab.tsx`
- Create: `packages/web/src/components/repository-dashboard/RepositoryDashboard.test.tsx`
- Modify: `packages/web/src/components/repository-dashboard/RepositoryDashboard.tsx`
- Modify: `packages/web/src/components/repository-dashboard/DashboardHeader.tsx`

**Interfaces:**
- Produces:
  ```ts
  // overview-helpers.ts
  export interface WorktreeRow {
    worktree: Worktree;
    diff?: DiffStats;
    ticket: Ticket | null;
    pr: PullRequest | null;
    verdict: WorktreeVerdict;
  }
  export function buildWorktreeRows(
    worktrees: Worktree[],
    diffStats: Record<string, DiffStats>,
    sessionGroup: SessionGroup | undefined,
    tickets: Ticket[],
    pulls: PullRequest[],           // open + merged concatenated
  ): { active: WorktreeRow[]; orphaned: WorktreeRow[] }
  // Sparkline.tsx
  export function Sparkline({ values, width = 120, height = 36 }: { values: number[]; width?: number; height?: number })
  // OverviewTab.tsx
  export function OverviewTab({ org, name, data, stats, onNavigate }: {
    org: string; name: string;
    data: RepositoryDashboardData;
    stats: RepositoryStats | null;
    onNavigate: (tab: 'pulls' | 'issues') => void;
  })
  ```
- Consumes: `deriveWorktreeVerdict`/`VERDICT_META`/`isRemovableVerdict` (Task 6), `fetchRepoStats`/`repoStats` (Task 5), `ConfirmModal` (Task 7), `api.deleteWorktree`, `useTicketStore().tickets`, `useSessionStore().sessionGroups`, `useTicketActivityStore().costByTicket`.

- [ ] **Step 1: Write the failing helper test**

```ts
// packages/web/src/components/repository-dashboard/overview-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { buildWorktreeRows } from './overview-helpers';

const wt = (branch: string, over = {}) => ({ path: `/wt/${branch}`, branch, isMain: false, isBare: false, ...over });
const ticket = (id: string, status: string, links: unknown[] = []) => ({ id, status, links, displayId: 1, title: 't' }) as never;

describe('buildWorktreeRows', () => {
  it('skips bare and main worktrees', () => {
    const { active, orphaned } = buildWorktreeRows(
      [wt('main', { isMain: true }), wt('x', { isBare: true })] as never, {}, undefined, [], [],
    );
    expect(active).toEqual([]);
    expect(orphaned).toEqual([]);
  });

  it('links a ticket via the session group path and buckets open tickets as active', () => {
    const group = { repositoryOrg: 'a', repositoryName: 'b', worktrees: [{ branch: 'f1', path: '/wt/f1', sessions: [], ticketId: 't1' }] } as never;
    const { active, orphaned } = buildWorktreeRows([wt('f1')] as never, { f1: { commitsAhead: 1, commitsBehind: 0, filesChanged: 0, additions: 0, deletions: 0 } }, group, [ticket('t1', 'doing')], []);
    expect(active).toHaveLength(1);
    expect(orphaned).toHaveLength(0);
    expect(active[0]!.ticket).not.toBeNull();
    expect(active[0]!.verdict).toBe('ready_to_push');
  });

  it('buckets done/missing tickets as orphaned with removable verdicts', () => {
    const { active, orphaned } = buildWorktreeRows(
      [wt('f1'), wt('f2')] as never, {}, undefined,
      [ticket('t1', 'done', [{ type: 'worktree', ref: '/wt/f1' }])], [],
    );
    expect(active).toHaveLength(0);
    expect(orphaned.map((r) => r.worktree.branch).sort()).toEqual(['f1', 'f2']);
    expect(orphaned.every((r) => r.verdict === 'stale_removable')).toBe(true);
  });

  it('attaches the matching PR and lets merged win', () => {
    const pr = { number: 9, headRefName: 'f1', state: 'merged' } as never;
    const group = { worktrees: [{ path: '/wt/f1', ticketId: 't1', sessions: [] }] } as never;
    const { active } = buildWorktreeRows([wt('f1')] as never, {}, group, [ticket('t1', 'doing')], [pr]);
    expect(active[0]!.pr).toBe(pr);
    expect(active[0]!.verdict).toBe('merged_removable');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** → FAIL (module not found).

- [ ] **Step 3: Implement `overview-helpers.ts`**

```ts
import type { Worktree, DiffStats, Ticket, PullRequest, SessionGroup } from '@fleex/shared';
import { deriveWorktreeVerdict, type WorktreeVerdict } from '../../lib/worktreeVerdict';

export interface WorktreeRow {
  worktree: Worktree;
  diff?: DiffStats;
  ticket: Ticket | null;
  pr: PullRequest | null;
  verdict: WorktreeVerdict;
}

const CLOSED = new Set(['done', 'cancelled']);

export function buildWorktreeRows(
  worktrees: Worktree[],
  diffStats: Record<string, DiffStats>,
  sessionGroup: SessionGroup | undefined,
  tickets: Ticket[],
  pulls: PullRequest[],
): { active: WorktreeRow[]; orphaned: WorktreeRow[] } {
  const active: WorktreeRow[] = [];
  const orphaned: WorktreeRow[] = [];

  for (const worktree of worktrees) {
    if (worktree.isBare || worktree.isMain) continue;

    const grouped = sessionGroup?.worktrees.find((w) => w.path === worktree.path);
    const ticket =
      (grouped?.ticketId ? tickets.find((t) => t.id === grouped.ticketId) : undefined) ??
      tickets.find((t) => t.links.some((l) => l.type === 'worktree' && (l.ref === worktree.path || l.ref.endsWith(`/${worktree.branch}`)))) ??
      null;
    const pr = pulls.find((p) => p.headRefName === worktree.branch) ?? null;
    const diff = diffStats[worktree.branch];

    const verdict = deriveWorktreeVerdict({
      commitsAhead: diff?.commitsAhead ?? 0,
      commitsBehind: diff?.commitsBehind ?? 0,
      ...(pr ? { prState: pr.state } : {}),
      ...(ticket ? { ticketStatus: ticket.status } : {}),
      ticketMissing: !ticket,
    });

    const row: WorktreeRow = { worktree, ticket, pr, verdict, ...(diff ? { diff } : {}) };
    if (!ticket || CLOSED.has(ticket.status)) orphaned.push(row);
    else active.push(row);
  }

  return { active, orphaned };
}
```

- [ ] **Step 4: Run test to verify it passes** → PASS (4 tests).

- [ ] **Step 5: `Sparkline.tsx`**

```tsx
export function Sparkline({ values, width = 120, height = 36 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null;
  const max = Math.max(...values);
  const points = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - 2 - (v / max) * (height - 6)}`)
    .join(' ');
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <polyline points={points} fill="none" stroke="var(--tint-yellow-solid)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
```

- [ ] **Step 6: `TicketsWorktreesPanel.tsx`**

Props: `{ org: string; name: string; rows: { active: WorktreeRow[]; orphaned: WorktreeRow[] }; onDeleted: () => void }`. Panel shell: `rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)]`; header row "Tickets & worktrees" `px-5 py-3 text-sm font-semibold border-b border-[var(--theme-border)]`.

Per active row (2 lines, `px-5 py-3 border-b border-[var(--theme-border-subtle)] last:border-0`):
- Ticket line: `#displayId` mono muted → type chip (`tint(hue)` with hue map `const TYPE_HUE: Record<TicketType, TintHue> = { fix: 'red', build: 'green', ops: 'teal', think: 'indigo', review: 'purple', lead: 'orange' }`) → title `text-[13.5px] font-semibold truncate`, clickable → `navigate(`/tickets/board/${ticket.boardId}/ticket/${ticket.id}`)` → status chip (map: backlog/todo → gray, doing → yellow, reviewing → purple, done → green, cancelled → red) → cost chip when `costByTicket[ticket.id]` (`tintClasses('pink').bg/.text`, mono, `$x.xx`) → PR chip when `row.pr` (`tint('green')`, mono, `⎇`-like branch SVG + `{name}#{pr.number}`).
- Worktree line: `└ {branch}` mono 12px secondary → `↑{commitsAhead}` in `tintText('green')` and `↓{commitsBehind}` in `tintText('red')` (only when > 0) → verdict badge `cn('rounded-md px-1.5 py-0.5 text-[10.5px]', tint(VERDICT_META[row.verdict].hue))` → trash button (same `TrashIcon` pattern as Task 9) → sets `pendingDelete = row`.

Orphaned sub-section (`id="orphaned-worktrees"`) when non-empty: label `cn('px-5 pt-3 pb-1 text-[10.5px] font-bold uppercase tracking-wider', tintText('red'))` "Orphaned worktrees"; rows: branch mono + `↓n` + `<Button variant="danger" size="sm">Remove</Button>` → same `pendingDelete` flow. (No age column — see Global Constraints deviation note.)

Delete flow: one `ConfirmModal` for the panel (`title="Delete worktree"`, message shows branch + `worktree.path`, busy state) → `await api.deleteWorktree(org, name, row.worktree.path)` → `onDeleted()`.

Empty panel (no rows at all): centered muted "No active worktrees".

- [ ] **Step 7: `OverviewTab.tsx`**

```tsx
export function OverviewTab({ org, name, data, stats, onNavigate }: { /* see Interfaces */ }) {
  const key = `${org}/${name}`;
  const tickets = useTicketStore((s) => s.tickets);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const costByTicket = useTicketActivityStore((s) => s.costByTicket);
  const fetchDashboard = useRepositoryDashboardStore((s) => s.fetchDashboard);

  const sessionGroup = sessionGroups.find((g) => g.repositoryOrg === org && g.repositoryName === name);
  const linkedTickets = useMemo(
    () => tickets.filter((t) => t.links.some((l) => l.type === 'repository' && l.ref.toLowerCase() === key.toLowerCase())),
    [tickets, key],
  );
  const pulls = useMemo(() => [...data.openPullRequests, ...data.recentlyMergedPullRequests], [data]);
  const rows = useMemo(
    () => buildWorktreeRows(data.worktrees, data.diffStats, sessionGroup, tickets, pulls),
    [data, sessionGroup, tickets, pulls],
  );
  // …
}
```
Layout `flex flex-col gap-5`:
1. **KPI grid** `grid grid-cols-[1.4fr_1fr_1fr_1fr] gap-4` — shared card shell `rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg-surface)] p-5`; each card: header `flex items-center gap-2 text-xs text-[var(--theme-text-secondary)]` with a `h-2 w-2 rounded-full` dot (`tintSolid(hue)`), value `text-[28px] font-bold leading-tight`, subtext `text-[11px] text-[var(--theme-text-muted)]`:
   - **Fleex cost · 30 d** (dot yellow): `${(stats?.totalCostUsd ?? 0).toFixed(0)}`, `<Sparkline values={stats?.dailyCosts.map((d) => d.costUsd) ?? []} />` beside the value, subtext `${stats.costPerTicketUsd.toFixed(2)} / ticket` + trend when `stats.previousTotalCostUsd > 0`: `▲/▼ {pct}%` (`tintText(pct >= 0 ? 'red' : 'green')` — cost going up is bad) where `pct = Math.round(((stats.totalCostUsd - stats.previousTotalCostUsd) / stats.previousTotalCostUsd) * 100)`. Render the arrow as a tiny SVG triangle, not an emoji.
   - **Tickets** (dot indigo): value = `linkedTickets.filter((t) => t.status === 'doing' || t.status === 'reviewing').length` "in progress", subtext `{done} done · {activeSessions} active sessions` where `done` = linked done count, `activeSessions = sessionGroup?.worktrees.reduce((n, w) => n + w.sessions.length, 0) ?? 0`.
   - **GitHub** (dot orange): value = open PR count, subtext `{openIssues.length} issues · {merged} merged (30 d)`.
   - **Worktrees** (dot teal): value = `rows.active.length + rows.orphaned.length`; when `stale = [...rows.active, ...rows.orphaned].filter((r) => isRemovableVerdict(r.verdict)).length` > 0 → subtext `<span className={tintText('red')}>{stale} stale</span>` + a link-button "Clean up now →" (`tintText('red')`, underline on hover) scrolling to the panel: `document.getElementById('orphaned-worktrees')?.scrollIntoView({ behavior: 'smooth' })`, and the card border becomes `cn('border', tintClasses('red').borderColor)`; else subtext "all tracked".
2. `<TicketsWorktreesPanel org={org} name={name} rows={rows} onDeleted={() => fetchDashboard(org, name)} />`
3. **Preview half-panels** `grid grid-cols-2 gap-4`, each same panel shell: header "Pull requests" / "Issues" + right link `<button onClick={() => onNavigate('pulls')} className="text-xs text-[var(--theme-accent)] hover:underline">{count} →</button>`; body = top 3 by `updatedAt` desc, two lines each (`#num` + semibold title / mono branch-or-author + relative age), row click opens GitHub. Empty → muted "None open".

- [ ] **Step 8: Wire tabs + header badge**

`RepositoryDashboard.tsx`:
```ts
type Tab = 'overview' | 'pulls' | 'issues' | 'config';
const [activeTab, setActiveTab] = useState<Tab>('overview');
const tabs: { key: Tab; label: string; count?: number }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'pulls', label: 'Pull Requests', count: openPRs.length },
  { key: 'issues', label: 'Issues', count: issues.length },
  { key: 'config', label: 'Config' },
];
```
- On repo change (`useEffect` on `[org, name]`): also `setActiveTab('overview')` and `fetchRepoStats(org, name)` (from `useRepositoryDashboardStore`).
- Render: `overview` → `<OverviewTab org={org} name={name} data={data} stats={repoStats[repoKey] ?? null} onNavigate={(t) => setActiveTab(t)} />` (guard: render only when `data`; while loading show the existing spinner/skeleton pattern); `config` → `<RepoConfigPanel …/>` (unchanged).
- `DashboardHeader`: add props `worktreeCount: number; isCloned: boolean` and render after the GitHub link: `isCloned` → `<span className={cn('rounded-full px-2 py-0.5 text-[10.5px]', tint('green'))}>cloned · {worktreeCount} worktrees</span>` else `tint('yellow')` "not cloned". Pass from `RepositoryDashboard` (`worktreeCount = data?.worktrees.filter((w) => !w.isBare && !w.isMain).length ?? 0`).

- [ ] **Step 9: Base tab test for `RepositoryDashboard`**

Create `packages/web/src/components/repository-dashboard/RepositoryDashboard.test.tsx` (first-ever test on this component — spec §3.3):

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RepositoryDashboard } from './RepositoryDashboard';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';

const data = {
  org: 'acme', name: 'app',
  openIssues: [], recentlyClosedIssues: [], openPullRequests: [], recentlyMergedPullRequests: [],
  worktrees: [], diffStats: {}, githubUser: 'me', isClonedLocally: true,
};

describe('RepositoryDashboard tabs', () => {
  beforeEach(() => {
    useRepositoryDashboardStore.setState({
      dashboardData: data as never,
      repoStats: {},
      fetchDashboard: vi.fn(async () => {}),
      fetchRepoStats: vi.fn(async () => {}),
    } as never);
  });
  afterEach(cleanup);

  it('renders the four tabs with Overview as default', () => {
    render(<MemoryRouter><RepositoryDashboard repoKey="acme/app" /></MemoryRouter>);
    for (const label of ['Overview', 'Pull Requests', 'Issues', 'Config']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText('Tickets & worktrees')).toBeTruthy(); // Overview content visible by default
  });

  it('switches tabs', () => {
    render(<MemoryRouter><RepositoryDashboard repoKey="acme/app" /></MemoryRouter>);
    fireEvent.click(screen.getByText('Config'));
    expect(screen.getByText('Post-checkout hook')).toBeTruthy();
  });
});
```
If a child component pulls store state this setup doesn't provide (e.g. ticket/session stores default to empty arrays — they should), seed the minimal state rather than mocking the child.

Run: `npx vitest run packages/web/src/components/repository-dashboard/RepositoryDashboard.test.tsx` → PASS (2 tests).

- [ ] **Step 10: Verify + commit**

Run: `npx vitest run packages/web/src/components/repository-dashboard/overview-helpers.test.ts` → PASS. `bun run lint` → PASS. `bun run test` → PASS. Visual check in `bun run dev`: Overview default tab, 4 KPI cards (cost card fills once `/stats` responds), tickets & worktrees rows with verdict badges, worktree deletion works end-to-end, previews navigate to their tabs.
```bash
git add -A && git commit -m "feat(web): per-repo overview dashboard with cost KPIs and worktree verdicts"
```

---

### Task 13: Remove Settings → Repositories

**Files:**
- Modify: `packages/web/src/stores/uiStore.ts:5` (`SettingsTab` union)
- Modify: `packages/web/src/components/settings/SettingsNav.tsx` (icon map + tab list)
- Modify: `packages/web/src/components/settings/SettingsPanel.tsx` (label map, `RepositoriesTab`, state, handlers)
- Modify: `packages/web/src/stores/settingsStore.ts` (drop `resolveRepositories` + `resolving`)
- Modify: `packages/web/src/router/RouterSync.tsx` (`VALID_SETTINGS_TABS` + legacy redirect)
- Modify: `packages/web/src/router/RouterSync.test.ts` / `RouterSync.sync.test.tsx` (expectations)

**Interfaces:**
- Consumes: nothing new. `TagInput` stays (still used by `TicketMetaSidebar`, `StepConfigPanel`).

- [ ] **Step 1: Strip the tab**

1. `uiStore.ts`: remove `'repositories'` from `SettingsTab`.
2. `SettingsNav.tsx`: delete the `repositories` entry from `tabIcons` and from `tabs`.
3. `SettingsPanel.tsx`: delete the `repositories` label, the whole `RepositoriesTab` function (lines ~273-299), its render branch (line ~143), the `repoPatterns` state + its `useEffect` seeding + `handleTagsChange` + `resolveTimerRef`, the `repositories: repoPatterns` key in `handleSave`, and the now-unused `TagInput` import + `resolveRepositories`/`resolving` selectors.
4. `settingsStore.ts`: delete `resolveRepositories` (interface + implementation) and the `resolving` flag. First `grep -rn "resolveRepositories\|s.resolving" packages/web/src` — if any consumer other than SettingsPanel remains, update it too.

- [ ] **Step 2: Router redirect**

In `RouterSync.tsx`: remove `'repositories'` from `VALID_SETTINGS_TABS`; in `parseUrl`, just before the `VALID_SETTINGS_TABS.includes(rawTab)` check (~line 248), add:
```ts
if ((settingsMatch[1] as string) === 'repositories') {
  // Legacy Settings → Repositories screen: config now lives in the Repos view.
  return { ...base, panel: 'repositories' };
}
```
(match the exact `base`/return shape used by the surrounding parse branches).

- [ ] **Step 3: Update the router tests**

`grep -n "repositories" packages/web/src/router/RouterSync.test.ts packages/web/src/router/RouterSync.sync.test.tsx`. Fix any expectation that `/settings/repositories` selects the settings panel; add one case asserting it now parses to `{ panel: 'repositories' }`.

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run packages/web/src/router/RouterSync.test.ts packages/web/src/router/RouterSync.sync.test.tsx` → PASS. `bun run lint` → PASS. `bun run test` → PASS. Visual check: Settings shows no Repositories entry; navigating to `/settings/repositories` lands on the Repos view.
```bash
git add -A && git commit -m "refactor(web): remove Settings > Repositories, redirect legacy route to the Repos view"
```

---

### Task 14: Full verification pass

**Files:** none (verification only; fix regressions in place).

- [ ] **Step 1: Static + unit gates**

Run: `bun run lint` → PASS (typecheck all packages + raw-palette check). Run: `bun run test` → PASS, including the new suites: repository-pattern-migration (4), github-discovery (4), get-repository-stats (3), settingsStore.repos (2), worktreeVerdict (7), ConfirmModal (3), AddRepositoriesModal (4), prFilters (4+), overview-helpers (4), RepositoryDashboard (2), RouterSync updated.

- [ ] **Step 2: End-to-end manual verification** (use the `verify` skill / `bun run dev`)

Walk the five prototype states against `../refonte/screenshots/`:
1. `01-vue-ensemble.png` — sidebar (search, chips, ACTIVE, wt badges, trash on hover) + Overview (KPI cards, tickets & worktrees, previews).
2. `02-prs-open.png` — segments + me-toggles + card rows + Import/Start buttons.
3. `03-prs-merged.png` — merged segment, cost chips, "worktree still present" + Clean up.
4. `04-issues.png` — issue segments + label chips + comment counts.
5. `05-modal-ajout.png` — discovery groups, toggles, already-tracked, select-all, free-form verify, footer recap.
Plus: repo removal round-trip (confirm → gone from sidebar → bare clone sync fires), `/settings/repositories` redirect, and a server restart with a hand-written `org/*` pattern in config to watch the migration expand it.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: post-verification adjustments for the repos redesign"
```
(Skip if nothing changed.)

import type {
  BrowseIssue,
  BrowseLinkedTicket,
  BrowsePullRequest,
  GitHubIssue,
  ImportBrowseInbox,
  ImportBrowseRepo,
  PullRequest,
} from '@fleex/shared';
import type { LoggerPort } from '../ports/logger.port.js';
import type { ExecFn } from '../../infrastructure/host/types.js';
import type { RepoBatchResult } from '../../infrastructure/adapters/github-graphql.adapter.js';
import { RepositoryCache } from '../../domain/services/repository-cache.js';
import { RepositoryNotFoundError } from '../../domain/errors.js';
import { isBotPullRequest } from '../../domain/services/bot-author.js';

interface RepoRef {
  org: string;
  name: string;
}

interface TicketLike {
  readonly id: string;
  readonly displayId: number;
  readonly links: readonly { readonly type: string; readonly ref: string }[];
}

export interface GetImportBrowseDeps {
  graphql: {
    getCurrentUser(): Promise<string>;
    fetchRepoBatch(repos: RepoRef[]): Promise<Map<string, RepoBatchResult>>;
  };
  cache: RepositoryCache;
  execFn: ExecFn;
  ticketStore: { getAllTickets(): Promise<readonly TicketLike[]> };
  /** The repos configured in Fleex, in Fleex's casing. Read on every call: config can change. */
  getRepos: () => RepoRef[];
  logger: LoggerPort;
}

/** Raw shape of `gh search issues --json …`. */
interface GhSearchIssue {
  number: number;
  title: string;
  author: { login: string };
  assignees: { login: string }[];
  repository: { nameWithOwner: string };
  updatedAt: string;
}

interface RepoSnapshot {
  repo: RepoRef;
  pulls: PullRequest[];
  issues: GitHubIssue[];
}

interface Loaded<T> {
  data: T;
  stale: boolean;
  storedAt: number;
}

const MY_ISSUES_KEY = 'browse:my-issues';
const SEARCH_FIELDS = 'number,title,author,assignees,repository,updatedAt';

/**
 * Feeds the "or browse" pickers of the new-task flow: what is mine across every
 * configured repo (`inbox`), and the open PRs/issues of one repo (`repo`).
 *
 * Built for a picker that must open instantly, so it never makes the caller wait
 * on GitHub for data it has already seen: it reads the same `pulls:`/`issues:`
 * entries the refresh scheduler writes, serves them even past their TTL (flagged
 * `stale`), and refreshes behind the answer. It only blocks on a true first miss.
 * It deliberately does NOT depend on the scheduler running — it is off by default.
 */
export class GetImportBrowseUseCase {
  /** In-flight refreshes, so concurrent callers share one GitHub round-trip. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: GetImportBrowseDeps) {}

  async inbox(): Promise<ImportBrowseInbox> {
    const repos = this.deps.getRepos();
    if (repos.length === 0) {
      return { githubUser: '', issues: [], reviewRequests: [], myPullRequests: [], fetchedAt: new Date().toISOString(), stale: false };
    }

    const [githubUser, snapshots, searched, linked] = await Promise.all([
      this.deps.graphql.getCurrentUser(),
      this.loadRepos(repos),
      this.loadMyIssues(repos),
      this.linkedTickets(),
    ]);

    const reviewRequests: BrowsePullRequest[] = [];
    const myPullRequests: BrowsePullRequest[] = [];
    const issues = new Map<string, BrowseIssue>();

    for (const { repo, pulls, issues: repoIssues } of snapshots.data) {
      for (const pull of pulls) {
        if (pull.author === githubUser) {
          myPullRequests.push(this.toPullRequest(repo, pull, linked));
        } else if (pull.assignees.includes(githubUser) || pull.reviewRequests?.includes(githubUser)) {
          reviewRequests.push(this.toPullRequest(repo, pull, linked));
        }
      }
      for (const issue of repoIssues) {
        if (issue.author === githubUser || issue.assignees.includes(githubUser)) {
          const row = this.toIssue(repo, issue, linked);
          issues.set(issueKey(row), row);
        }
      }
    }
    // The search reaches past the 50 most recent issues per repo the cache holds.
    for (const row of searched.data) {
      const withLink = { ...row, ...this.linkFor(linked.issues, `${row.org}/${row.name}#${row.number}`) };
      if (!issues.has(issueKey(withLink))) issues.set(issueKey(withLink), withLink);
    }

    return {
      githubUser,
      issues: [...issues.values()].sort(byUpdatedDesc),
      reviewRequests: reviewRequests.sort(byUpdatedDesc),
      myPullRequests: myPullRequests.sort(byUpdatedDesc),
      fetchedAt: new Date(Math.min(snapshots.storedAt, searched.storedAt)).toISOString(),
      stale: snapshots.stale || searched.stale,
    };
  }

  async repo(org: string, name: string): Promise<ImportBrowseRepo> {
    const wanted = `${org}/${name}`.toLowerCase();
    const repo = this.deps.getRepos().find((r) => `${r.org}/${r.name}`.toLowerCase() === wanted);
    // Only configured repos: `org`/`name` end up interpolated in a GraphQL query.
    if (!repo) throw new RepositoryNotFoundError(`${org}/${name}`);

    const [snapshots, linked] = await Promise.all([this.loadRepos([repo]), this.linkedTickets()]);
    const snapshot = snapshots.data[0];
    return {
      pullRequests: (snapshot?.pulls ?? []).map((p) => this.toPullRequest(repo, p, linked)),
      issues: (snapshot?.issues ?? []).map((i) => this.toIssue(repo, i, linked)),
      fetchedAt: new Date(snapshots.storedAt).toISOString(),
      stale: snapshots.stale,
    };
  }

  // ── loading ────────────────────────────────────────────────────────────────

  private async loadRepos(repos: RepoRef[]): Promise<Loaded<RepoSnapshot[]>> {
    const read = (repo: RepoRef) => {
      const key = `${repo.org}/${repo.name}`;
      const pulls = this.deps.cache.peek<PullRequest[]>(`pulls:${key}`);
      const issues = this.deps.cache.peek<GitHubIssue[]>(`issues:${key}`);
      return pulls && issues ? { repo, pulls, issues } : null;
    };

    const missing = repos.filter((r) => !read(r));
    if (missing.length > 0) await this.refreshRepos(missing);

    const snapshots: RepoSnapshot[] = [];
    const staleRepos: RepoRef[] = [];
    let storedAt = Date.now();
    for (const repo of repos) {
      const entry = read(repo);
      if (!entry) continue; // GitHub failed for this repo — leave it out rather than fail the picker
      snapshots.push({ repo, pulls: entry.pulls.data, issues: entry.issues.data });
      storedAt = Math.min(storedAt, entry.pulls.storedAt, entry.issues.storedAt);
      if (entry.pulls.stale || entry.issues.stale) staleRepos.push(repo);
    }

    if (staleRepos.length > 0) {
      void this.refreshRepos(staleRepos).catch((err) => {
        this.deps.logger.warn('Import browse: background repo refresh failed', { error: String(err) });
      });
    }
    return { data: snapshots, stale: staleRepos.length > 0, storedAt };
  }

  /** Fetches the repos and writes them where the scheduler would — one call per distinct set. */
  private refreshRepos(repos: RepoRef[]): Promise<unknown> {
    const id = `repos:${repos.map((r) => `${r.org}/${r.name}`).sort().join(',')}`;
    return this.once(id, async () => {
      const results = await this.deps.graphql.fetchRepoBatch(repos);
      for (const [key, result] of results) {
        this.deps.cache.set(`pulls:${key}`, result.pulls, RepositoryCache.TTL_PULLS);
        this.deps.cache.set(`issues:${key}`, result.issues, RepositoryCache.TTL_ISSUES);
      }
    });
  }

  private async loadMyIssues(repos: RepoRef[]): Promise<Loaded<BrowseIssue[]>> {
    const cached = this.deps.cache.peek<BrowseIssue[]>(MY_ISSUES_KEY);
    if (cached) {
      if (cached.stale) {
        void this.searchMyIssues(repos).catch(() => {}); // already logged
      }
      return cached;
    }
    try {
      await this.searchMyIssues(repos);
    } catch {
      // Degrade to the issues the repo cache knows about (merged in by `inbox`).
      return { data: [], stale: false, storedAt: Date.now() };
    }
    return this.deps.cache.peek<BrowseIssue[]>(MY_ISSUES_KEY) ?? { data: [], stale: false, storedAt: Date.now() };
  }

  private searchMyIssues(repos: RepoRef[]): Promise<unknown> {
    return this.once('my-issues', async () => {
      const byLowerKey = new Map(repos.map((r) => [`${r.org}/${r.name}`.toLowerCase(), r]));
      const repoFlags = repos.flatMap((r) => ['--repo', `${r.org}/${r.name}`]);
      const search = (who: '--author' | '--assignee') =>
        this.deps.execFn(
          'gh',
          ['search', 'issues', who, '@me', '--state', 'open', ...repoFlags, '--json', SEARCH_FIELDS, '--limit', '50'],
          { timeout: 20_000 },
        );
      try {
        const [authored, assigned] = await Promise.all([search('--author'), search('--assignee')]);
        const rows = new Map<string, BrowseIssue>();
        for (const raw of [...parseSearch(authored.stdout), ...parseSearch(assigned.stdout)]) {
          const repo = byLowerKey.get(raw.repository.nameWithOwner.toLowerCase());
          if (!repo) continue;
          const row: BrowseIssue = {
            org: repo.org,
            name: repo.name,
            number: raw.number,
            title: raw.title,
            author: raw.author?.login ?? 'unknown',
            assignees: (raw.assignees ?? []).map((a) => a.login),
            updatedAt: raw.updatedAt,
          };
          rows.set(issueKey(row), row);
        }
        this.deps.cache.set(MY_ISSUES_KEY, [...rows.values()], RepositoryCache.TTL_ISSUES);
      } catch (err) {
        this.deps.logger.warn('Import browse: issue search failed', { error: String(err) });
        throw err;
      }
    });
  }

  private once(id: string, run: () => Promise<unknown>): Promise<unknown> {
    const running = this.inflight.get(id);
    if (running) return running;
    const started = run().finally(() => this.inflight.delete(id));
    this.inflight.set(id, started);
    return started;
  }

  // ── mapping ────────────────────────────────────────────────────────────────

  private async linkedTickets() {
    const issues = new Map<string, BrowseLinkedTicket>();
    const pulls = new Map<string, BrowseLinkedTicket>();
    const worktrees = new Map<string, BrowseLinkedTicket>();
    for (const ticket of await this.deps.ticketStore.getAllTickets()) {
      const linked = { id: ticket.id, displayId: ticket.displayId };
      for (const link of ticket.links) {
        // Lowercased on both sides: PR refs are stored lowercase today but older
        // links kept GitHub's casing, and issue refs keep theirs.
        if (link.type === 'github_issue') issues.set(link.ref.toLowerCase(), linked);
        else if (link.type === 'github_pr') pulls.set(link.ref.toLowerCase(), linked);
        else if (link.type === 'worktree') worktrees.set(link.ref.toLowerCase(), linked);
      }
    }
    return { issues, pulls, worktrees };
  }

  private linkFor(map: Map<string, BrowseLinkedTicket>, ref: string): { linkedTicket?: BrowseLinkedTicket } {
    const linkedTicket = map.get(ref.toLowerCase());
    return linkedTicket ? { linkedTicket } : {};
  }

  private toPullRequest(
    repo: RepoRef,
    pull: PullRequest,
    linked: Awaited<ReturnType<GetImportBrowseUseCase['linkedTickets']>>,
  ): BrowsePullRequest {
    const key = `${repo.org}/${repo.name}`;
    const link =
      this.linkFor(linked.pulls, `${key}#${pull.number}`).linkedTicket ??
      this.linkFor(linked.worktrees, `${key}:${pull.headRefName}`).linkedTicket;
    return {
      org: repo.org,
      name: repo.name,
      number: pull.number,
      title: pull.title,
      headRefName: pull.headRefName,
      author: pull.author,
      isDraft: pull.isDraft === true,
      isBot: isBotPullRequest(pull.author, pull.headRefName),
      updatedAt: pull.updatedAt,
      ...(link ? { linkedTicket: link } : {}),
    };
  }

  private toIssue(
    repo: RepoRef,
    issue: GitHubIssue,
    linked: Awaited<ReturnType<GetImportBrowseUseCase['linkedTickets']>>,
  ): BrowseIssue {
    return {
      org: repo.org,
      name: repo.name,
      number: issue.number,
      title: issue.title,
      author: issue.author,
      assignees: issue.assignees,
      updatedAt: issue.updatedAt,
      ...this.linkFor(linked.issues, `${repo.org}/${repo.name}#${issue.number}`),
    };
  }
}

function parseSearch(stdout: string): GhSearchIssue[] {
  const parsed: unknown = JSON.parse(stdout);
  return Array.isArray(parsed) ? (parsed as GhSearchIssue[]) : [];
}

const issueKey = (i: { org: string; name: string; number: number }) => `${i.org}/${i.name}#${i.number}`.toLowerCase();
const byUpdatedDesc = (a: { updatedAt: string }, b: { updatedAt: string }) => b.updatedAt.localeCompare(a.updatedAt);

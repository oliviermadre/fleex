import type { PullRequest, GitHubIssue, GitHubIssueDetail } from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { ExecFn } from '../host/types.js';

interface GraphQLPRNode {
  number: number;
  title: string;
  headRefName: string;
  isDraft?: boolean;
  author: { login: string } | null;
  assignees: { nodes: { login: string }[] };
  reviewRequests?: { nodes: { requestedReviewer: { login: string } | null }[] };
  createdAt: string;
  updatedAt: string;
  mergedAt: string | null;
}

interface GraphQLIssueNode {
  number: number;
  title: string;
  author: { login: string } | null;
  assignees?: { nodes: { login: string }[] };
  createdAt: string;
  updatedAt: string;
}

interface GraphQLRepoResult {
  pullRequests: { totalCount: number; nodes: GraphQLPRNode[] };
  mergedPRs: { nodes: GraphQLPRNode[] };
  issues: { totalCount: number; nodes: GraphQLIssueNode[] };
}

export interface RepoBatchResult {
  pulls: PullRequest[];
  issues: GitHubIssue[];
  mergedPRs: PullRequest[];
  openPRsCount: number;
  openIssuesCount: number;
}

export interface RateLimitInfo {
  remaining: number;
  resetAt: Date;
}

const BATCH_SIZE = 8;

export class GitHubGraphQLAdapter {
  private cachedUser: string | null = null;

  constructor(
    private readonly execFn: ExecFn,
    private readonly logger: LoggerPort,
  ) {}

  async getCurrentUser(): Promise<string> {
    if (this.cachedUser) return this.cachedUser;
    try {
      const { stdout } = await this.execFn('gh', ['api', 'user', '--jq', '.login'], {
        timeout: 10_000,
      });
      this.cachedUser = stdout.trim();
      return this.cachedUser;
    } catch (err) {
      this.logger.warn('Failed to get GitHub user', { error: String(err) });
      return '';
    }
  }

  async fetchRepoBatch(
    repos: { org: string; name: string }[],
  ): Promise<Map<string, RepoBatchResult>> {
    const results = new Map<string, RepoBatchResult>();

    // Process in batches of BATCH_SIZE
    for (let i = 0; i < repos.length; i += BATCH_SIZE) {
      const batch = repos.slice(i, i + BATCH_SIZE);
      const batchResults = await this.executeBatch(batch);
      for (const [key, value] of batchResults) {
        results.set(key, value);
      }
    }

    return results;
  }

  async fetchIssueDetail(org: string, name: string, number: number): Promise<GitHubIssueDetail> {
    const query = `{
      repository(owner: "${org}", name: "${name}") {
        issue(number: ${number}) {
          number title body url state
          author { login }
          assignees(first: 10) { nodes { login } }
          labels(first: 20) { nodes { name } }
          milestone { title }
          comments(first: 100) {
            nodes { author { login } body createdAt }
          }
        }
      }
    }`;

    const { stdout } = await this.execFn('gh', [
      'api', 'graphql',
      '-f', `query=${query}`,
      '--jq', '.data.repository.issue',
    ], { timeout: 15_000 });

    const raw = JSON.parse(stdout) as {
      number: number; title: string; body: string; url: string; state: string;
      author: { login: string } | null;
      assignees: { nodes: { login: string }[] };
      labels: { nodes: { name: string }[] };
      milestone: { title: string } | null;
      comments: { nodes: { author: { login: string } | null; body: string; createdAt: string }[] };
    };

    return {
      number: raw.number,
      title: raw.title,
      body: raw.body ?? '',
      url: raw.url,
      state: raw.state,
      author: raw.author?.login ?? 'unknown',
      assignees: raw.assignees.nodes.map((a) => a.login),
      labels: raw.labels.nodes.map((l) => l.name),
      milestone: raw.milestone?.title ?? null,
      comments: raw.comments.nodes.map((c) => ({
        author: c.author?.login ?? 'unknown',
        body: c.body,
        createdAt: c.createdAt,
      })),
    };
  }

  /**
   * Fetch the state of multiple PRs in a single GraphQL call.
   * Returns a map of "org/name#number" → "OPEN" | "MERGED" | "CLOSED".
   */
  async fetchPRStates(prs: { org: string; name: string; number: number }[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (prs.length === 0) return result;

    const prQueries = prs.map((pr, idx) => {
      return `pr${idx}: repository(owner: "${pr.org}", name: "${pr.name}") {
      pullRequest(number: ${pr.number}) { state }
    }`;
    });

    try {
      const query = `{ ${prQueries.join('\n')} }`;
      const { stdout } = await this.execFn('gh', [
        'api', 'graphql',
        '-f', `query=${query}`,
        '--jq', '.data',
      ], { timeout: 15_000 });

      const data = JSON.parse(stdout) as Record<string, { pullRequest: { state: string } | null } | null>;
      prs.forEach((pr, idx) => {
        const entry = data[`pr${idx}`];
        const state = entry?.pullRequest?.state;
        if (state) {
          result.set(`${pr.org}/${pr.name}#${pr.number}`, state);
        }
      });
    } catch (err) {
      this.logger.warn('Failed to fetch PR states', { error: String(err) });
    }

    return result;
  }

  async getRateLimit(): Promise<RateLimitInfo> {
    try {
      const { stdout } = await this.execFn('gh', [
        'api', 'graphql',
        '-f', 'query={ rateLimit { remaining resetAt } }',
        '--jq', '.data.rateLimit',
      ], { timeout: 10_000 });
      const data = JSON.parse(stdout) as { remaining: number; resetAt: string };
      return {
        remaining: data.remaining,
        resetAt: new Date(data.resetAt),
      };
    } catch (err) {
      this.logger.warn('Failed to get rate limit', { error: String(err) });
      return { remaining: 5000, resetAt: new Date(Date.now() + 3600000) };
    }
  }

  private async executeBatch(
    repos: { org: string; name: string }[],
  ): Promise<Map<string, RepoBatchResult>> {
    const results = new Map<string, RepoBatchResult>();

    // Build the merged date filter (7 days ago)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Build GraphQL query
    const repoQueries = repos.map((repo, idx) => {
      const alias = `repo${idx}`;
      return `${alias}: repository(owner: "${repo.org}", name: "${repo.name}") {
      pullRequests(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
        totalCount
        nodes {
          number
          title
          headRefName
          isDraft
          author { login }
          assignees(first: 10) { nodes { login } }
          reviewRequests(first: 10) { nodes { requestedReviewer { ... on User { login } } } }
          createdAt
          updatedAt
        }
      }
      mergedPRs: pullRequests(first: 20, states: MERGED, orderBy: {field: UPDATED_AT, direction: DESC}) {
        nodes {
          number
          title
          headRefName
          author { login }
          assignees(first: 10) { nodes { login } }
          createdAt
          updatedAt
          mergedAt
        }
      }
      issues(first: 50, states: OPEN, orderBy: {field: UPDATED_AT, direction: DESC}) {
        totalCount
        nodes {
          number
          title
          author { login }
          assignees(first: 10) { nodes { login } }
          createdAt
          updatedAt
        }
      }
    }`;
    });

    const query = `{ ${repoQueries.join('\n')} }`;

    try {
      const { stdout } = await this.execFn('gh', [
        'api', 'graphql',
        '-f', `query=${query}`,
        '--jq', '.data',
      ], { timeout: 30_000, maxBuffer: 10 * 1024 * 1024 });

      const data = JSON.parse(stdout) as Record<string, GraphQLRepoResult>;

      repos.forEach((repo, idx) => {
        const alias = `repo${idx}`;
        const repoData = data[alias];
        if (!repoData) return;

        const key = `${repo.org}/${repo.name}`;

        const pulls: PullRequest[] = repoData.pullRequests.nodes.map((pr) => ({
          number: pr.number,
          title: pr.title,
          headRefName: pr.headRefName,
          state: 'open' as const,
          isDraft: pr.isDraft ?? false,
          author: pr.author?.login ?? 'unknown',
          assignees: pr.assignees.nodes.map((a) => a.login),
          reviewRequests: (pr.reviewRequests?.nodes ?? [])
            .map((r) => r.requestedReviewer?.login)
            .filter((login): login is string => !!login),
          createdAt: pr.createdAt,
          updatedAt: pr.updatedAt,
        }));

        const mergedPRs: PullRequest[] = repoData.mergedPRs.nodes
          .filter((pr) => pr.mergedAt && pr.mergedAt >= sevenDaysAgo)
          .map((pr) => ({
            number: pr.number,
            title: pr.title,
            headRefName: pr.headRefName,
            state: 'merged' as const,
            author: pr.author?.login ?? 'unknown',
            assignees: pr.assignees.nodes.map((a) => a.login),
            createdAt: pr.createdAt,
            updatedAt: pr.updatedAt,
            mergedAt: pr.mergedAt!,
          }));

        const issues: GitHubIssue[] = repoData.issues.nodes.map((issue) => ({
          number: issue.number,
          title: issue.title,
          author: issue.author?.login ?? 'unknown',
          assignees: (issue.assignees?.nodes ?? []).map((a: { login: string }) => a.login),
          createdAt: issue.createdAt,
          updatedAt: issue.updatedAt,
        }));

        results.set(key, {
          pulls,
          issues,
          mergedPRs,
          openPRsCount: repoData.pullRequests.totalCount,
          openIssuesCount: repoData.issues.totalCount,
        });
      });
    } catch (err) {
      this.logger.error('GraphQL batch query failed', {
        repos: repos.map((r) => `${r.org}/${r.name}`),
        error: err instanceof Error ? err.message : String(err),
      });
      // Fall back to individual gh CLI calls
      for (const repo of repos) {
        try {
          const result = await this.fetchSingleRepo(repo.org, repo.name);
          results.set(`${repo.org}/${repo.name}`, result);
        } catch (innerErr) {
          this.logger.warn('Individual repo fetch also failed', {
            repo: `${repo.org}/${repo.name}`,
            error: String(innerErr),
          });
        }
      }
    }

    return results;
  }

  private async fetchSingleRepo(org: string, name: string): Promise<RepoBatchResult> {
    const repoSlug = `${org}/${name}`;

    // Fetch open PRs
    const { stdout: prOut } = await this.execFn('gh', [
      'pr', 'list', '--repo', repoSlug,
      '--json', 'number,title,headRefName,isDraft,author,assignees,createdAt,updatedAt',
      '--limit', '50', '--state', 'open',
    ], { timeout: 15_000 });

    const rawPRs = JSON.parse(prOut) as {
      number: number; title: string; headRefName: string; isDraft: boolean;
      author: { login: string }; assignees: { login: string }[];
      createdAt: string; updatedAt: string;
    }[];

    const pulls: PullRequest[] = rawPRs.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      state: 'open' as const,
      isDraft: pr.isDraft,
      author: pr.author.login,
      assignees: pr.assignees.map((a) => a.login),
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
    }));

    // Fetch merged PRs
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const dateStr = sevenDaysAgo.toISOString().split('T')[0];
    const { stdout: mergedOut } = await this.execFn('gh', [
      'pr', 'list', '--repo', repoSlug,
      '--json', 'number,title,headRefName,author,assignees,createdAt,updatedAt,mergedAt',
      '--limit', '20', '--state', 'merged', '--search', `merged:>${dateStr}`,
    ], { timeout: 15_000 });

    const rawMerged = JSON.parse(mergedOut) as {
      number: number; title: string; headRefName: string;
      author: { login: string }; assignees: { login: string }[];
      createdAt: string; updatedAt: string; mergedAt: string;
    }[];

    const mergedPRs: PullRequest[] = rawMerged.map((pr) => ({
      number: pr.number,
      title: pr.title,
      headRefName: pr.headRefName,
      state: 'merged' as const,
      author: pr.author.login,
      assignees: pr.assignees.map((a) => a.login),
      createdAt: pr.createdAt,
      updatedAt: pr.updatedAt,
      mergedAt: pr.mergedAt,
    }));

    // Fetch issues
    const { stdout: issueOut } = await this.execFn('gh', [
      'issue', 'list', '--repo', repoSlug,
      '--json', 'number,title,author,assignees,createdAt,updatedAt',
      '--state', 'open', '--limit', '50',
    ], { timeout: 15_000 });

    const rawIssues = JSON.parse(issueOut) as {
      number: number; title: string;
      author: { login: string }; assignees: { login: string }[];
      createdAt: string; updatedAt: string;
    }[];

    const issues: GitHubIssue[] = rawIssues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      author: issue.author.login,
      assignees: (issue.assignees ?? []).map((a) => a.login),
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
    }));

    return {
      pulls,
      issues,
      mergedPRs,
      openPRsCount: pulls.length,
      openIssuesCount: issues.length,
    };
  }
}

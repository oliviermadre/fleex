import type { LoggerPort } from '../../application/ports/logger.port.js';
import type { GitHubGraphQLAdapter, RepoBatchResult } from '../../infrastructure/adapters/github-graphql.adapter.js';
import { RepositoryCache } from './repository-cache.js';
import type { RepositorySummary } from '@fleex/shared';

export interface RepoRef {
  org: string;
  name: string;
}

export type BroadcastFn = (type: string, data: unknown) => void;

export class RepositoryRefreshScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private refreshing = false;
  private repos: RepoRef[] = [];
  private broadcast: BroadcastFn = () => {};
  private onMergedPRs: ((mergedPRs: import('@fleex/shared').PullRequest[], repoKey: string) => Promise<void>) | null = null;

  constructor(
    private readonly graphql: GitHubGraphQLAdapter,
    private readonly cache: RepositoryCache,
    private readonly logger: LoggerPort,
  ) {}

  setBroadcast(fn: BroadcastFn): void {
    this.broadcast = fn;
  }

  setOnMergedPRs(fn: (mergedPRs: import('@fleex/shared').PullRequest[], repoKey: string) => Promise<void>): void {
    this.onMergedPRs = fn;
  }

  setRepos(repos: RepoRef[]): void {
    this.repos = repos;
  }

  start(intervalMs: number): void {
    this.stop();
    if (intervalMs <= 0) return;

    this.timer = setInterval(() => {
      this.refresh().catch((err) => {
        this.logger.error('Scheduled refresh failed', { error: String(err) });
      });
    }, intervalMs);
    this.logger.info('Repository refresh scheduler started', { intervalMs });
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async refresh(scope?: { org: string; name: string }): Promise<void> {
    if (this.refreshing) return;
    this.refreshing = true;

    try {
      this.broadcast('repo:refresh-started', {});

      // Check rate limit
      const rateLimit = await this.graphql.getRateLimit();
      if (rateLimit.remaining < 100) {
        this.broadcast('repo:rate-limit-warning', {
          remaining: rateLimit.remaining,
          resetAt: rateLimit.resetAt.toISOString(),
        });
        this.logger.warn('GitHub rate limit low, skipping refresh', { remaining: rateLimit.remaining });
        return;
      }

      if (rateLimit.remaining < 500) {
        this.broadcast('repo:rate-limit-warning', {
          remaining: rateLimit.remaining,
          resetAt: rateLimit.resetAt.toISOString(),
        });
      }

      const targets = scope
        ? this.repos.filter((r) => r.org === scope.org && r.name === scope.name)
        : this.repos;

      if (targets.length === 0) return;

      const githubUser = await this.graphql.getCurrentUser();
      const batchResults = await this.graphql.fetchRepoBatch(targets);

      // Update cache and build summaries
      const summaries: RepositorySummary[] = [];
      const now = new Date().toISOString();

      for (const [key, result] of batchResults) {
        const [org, name] = key.split('/');
        if (!org || !name) continue;

        // Cache individual data
        this.cache.set(`pulls:${key}`, result.pulls, RepositoryCache.TTL_PULLS);
        this.cache.set(`issues:${key}`, result.issues, RepositoryCache.TTL_ISSUES);
        this.cache.set(`merged:${key}`, result.mergedPRs, RepositoryCache.TTL_MERGED);

        const summary = this.buildSummary(org, name, result, githubUser, now);
        this.cache.set(`summary:${key}`, summary, RepositoryCache.TTL_SUMMARY);
        summaries.push(summary);

        // Notify merge detector
        if (this.onMergedPRs && result.mergedPRs.length > 0) {
          this.onMergedPRs(result.mergedPRs, key).catch((err) => {
            this.logger.warn('Merge detection failed', { key, error: String(err) });
          });
        }
      }

      // Also keep summaries for repos not in current batch
      for (const repo of this.repos) {
        const key = `${repo.org}/${repo.name}`;
        if (!batchResults.has(key)) {
          const cached = this.cache.get<RepositorySummary>(`summary:${key}`);
          if (cached) summaries.push(cached.data);
        }
      }

      this.broadcast('repo:summaries-updated', summaries);
      this.broadcast('repo:refresh-complete', { timestamp: now });
    } finally {
      this.refreshing = false;
    }
  }

  private buildSummary(
    org: string,
    name: string,
    result: RepoBatchResult,
    githubUser: string,
    fetchedAt: string,
  ): RepositorySummary {
    return {
      org,
      name,
      openIssuesCount: result.openIssuesCount,
      myPRsCount: result.pulls.filter((pr) => pr.author === githubUser).length,
      assignedPRsCount: result.pulls.filter((pr) => pr.assignees.includes(githubUser)).length,
      openPRsCount: result.openPRsCount,
      recentlyMergedPRsCount: result.mergedPRs.length,
      lastFetchedAt: fetchedAt,
    };
  }

  get isRefreshing(): boolean {
    return this.refreshing;
  }
}

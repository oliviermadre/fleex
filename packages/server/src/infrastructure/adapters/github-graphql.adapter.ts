import type { PullRequest, GitHubIssue, GitHubIssueDetail, PrCheck, PrCiDetail, PrCiSummary, PrMergeMethod } from '@fleex/shared';
import { PR_MERGE_METHODS } from '@fleex/shared';
import type { LoggerPort } from '../../application/ports/logger.port.js';
import {
  aggregateCiStatus, allowedMergeMethods, checkRunBucket, countsFromStates, sortChecks, toCiBucket,
} from '../../domain/services/pr-ci.js';
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
  state: string;
  closedAt: string | null;
  author: { login: string } | null;
  assignees?: { nodes: { login: string }[] };
  labels?: { nodes: { name: string; color: string }[] };
  comments?: { totalCount: number };
  createdAt: string;
  updatedAt: string;
}

interface GraphQLRepoResult {
  pullRequests: { totalCount: number; nodes: GraphQLPRNode[] };
  mergedPRs: { nodes: GraphQLPRNode[] };
  issues: { totalCount: number; nodes: GraphQLIssueNode[] };
  closedIssues: { nodes: GraphQLIssueNode[] };
}

/** A pull request's live state and size — what the Work queue's PR glyph shows. */
export interface PRDetails {
  state: string;
  isDraft: boolean;
  title: string;
  additions: number;
  deletions: number;
  url: string;
}

/**
 * The full detail of a single pull request, mirroring {@link GitHubIssueDetail}.
 * Used by the PR import adapter to prefill a draft (title + body + branch + fork
 * flag). `state` is GitHub's `OPEN | MERGED | CLOSED`.
 */
export interface GitHubPullRequestDetail {
  number: number;
  title: string;
  body: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: string;
  headRefName: string;
  baseRefName: string;
  isCrossRepository: boolean;
  nameWithOwner: string;
}

/** Owner and repo names are interpolated into GraphQL: only plain GitHub identifiers get through. */
const GITHUB_NAME_RE = /^[A-Za-z0-9_.-]+$/;

export interface RepoBatchResult {
  pulls: PullRequest[];
  issues: GitHubIssue[];
  closedIssues: GitHubIssue[];
  mergedPRs: PullRequest[];
  openPRsCount: number;
  openIssuesCount: number;
}

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

// Raw shape returned by `gh issue list --json ...` (flat arrays, unlike the GraphQL node shape above).
interface CliIssue {
  number: number;
  title: string;
  state: string;
  closedAt: string | null;
  author: { login: string };
  assignees: { login: string }[];
  labels: { name: string; color: string }[];
  comments: unknown[];
  createdAt: string;
  updatedAt: string;
}

function mapCliIssue(issue: CliIssue): GitHubIssue {
  return {
    number: issue.number,
    title: issue.title,
    state: issue.state?.toLowerCase() === 'closed' ? 'closed' : 'open',
    author: issue.author?.login ?? 'unknown',
    assignees: (issue.assignees ?? []).map((a) => a.login),
    labels: (issue.labels ?? []).map((l) => ({ name: l.name, color: l.color })),
    commentsCount: Array.isArray(issue.comments) ? issue.comments.length : 0,
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    ...(issue.closedAt ? { closedAt: issue.closedAt } : {}),
  };
}

export interface RateLimitInfo {
  remaining: number;
  resetAt: Date;
}

const BATCH_SIZE = 8;

/** PRs per aliased GraphQL call when fetching CI summaries. */
const CI_SUMMARY_BATCH = 50;
const HEAD_SHA_RE = /^[0-9a-f]{40}$/;

type StateCount = { state: string; count: number };

interface GraphQLCiContexts {
  totalCount?: number;
  checkRunCountsByState?: StateCount[] | null;
  statusContextCountsByState?: StateCount[] | null;
  nodes?: GraphQLCiContextNode[];
}

type GraphQLCiContextNode =
  | {
    __typename: 'CheckRun';
    name: string;
    status: string;
    conclusion: string | null;
    detailsUrl: string | null;
    startedAt: string | null;
    completedAt: string | null;
    checkSuite: { workflowRun: { workflow: { name: string } | null } | null } | null;
  }
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null; createdAt: string | null }
  | { __typename: string };

interface GraphQLCiSummaryNode {
  state: PrCiSummary['state'];
  isDraft: boolean;
  commits: { nodes: { commit: { statusCheckRollup: { contexts: GraphQLCiContexts } | null } }[] };
}

interface GraphQLCiDetailNode extends GraphQLCiSummaryNode {
  title: string;
  url: string;
  baseRefName: string;
  headRefOid: string;
  mergeable: PrCiDetail['mergeable'];
  mergeStateStatus: PrCiDetail['mergeStateStatus'];
}

interface GraphQLCiRepoNode {
  mergeCommitAllowed: boolean;
  squashMergeAllowed: boolean;
  rebaseMergeAllowed: boolean;
  viewerDefaultMergeMethod: string | null;
  pullRequest: GraphQLCiDetailNode | null;
}

/** The chip's store key: GitHub names are case-insensitive, links are stored lowercase. */
function prCiRef(pr: { org: string; name: string; number: number }): string {
  return `${pr.org}/${pr.name}#${pr.number}`.toLowerCase();
}

function toCiSummary(ref: string, node: GraphQLCiSummaryNode, contexts: GraphQLCiContexts | undefined): PrCiSummary {
  const counts = countsFromStates(contexts?.checkRunCountsByState ?? []);
  countsFromStates(contexts?.statusContextCountsByState ?? [], counts);
  return { ref, state: node.state, isDraft: node.isDraft, ciStatus: aggregateCiStatus(counts), counts };
}

function toCheck(node: GraphQLCiContextNode): PrCheck | null {
  if (node.__typename === 'CheckRun' && 'status' in node) {
    const workflow = node.checkSuite?.workflowRun?.workflow?.name;
    return {
      name: workflow ? `${workflow} / ${node.name}` : node.name,
      bucket: checkRunBucket(node.status, node.conclusion),
      detailsUrl: node.detailsUrl,
      startedAt: node.startedAt,
      completedAt: node.completedAt,
    };
  }
  if (node.__typename === 'StatusContext' && 'context' in node) {
    return {
      name: node.context,
      bucket: toCiBucket(node.state),
      detailsUrl: node.targetUrl,
      startedAt: node.createdAt,
      completedAt: null,
    };
  }
  return null;
}

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

    // Batches of BATCH_SIZE, side by side: run one after the other, the wait of
    // every caller grew with the number of configured repos. `executeBatch`
    // handles its own failures (it falls back to per-repo calls), so one bad
    // batch cannot reject the others.
    const batches: { org: string; name: string }[][] = [];
    for (let i = 0; i < repos.length; i += BATCH_SIZE) {
      batches.push(repos.slice(i, i + BATCH_SIZE));
    }
    for (const batchResults of await Promise.all(batches.map((batch) => this.executeBatch(batch)))) {
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
    } | null;

    // `--jq .data.repository.issue` yields `null` for a missing issue on an
    // existing repo (exit 0). Surface it as not-found rather than dereferencing null.
    if (!raw) throw new Error(`Could not resolve issue ${org}/${name}#${number}`);

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
   * Fetch the full detail of a single pull request. Mirrors {@link fetchIssueDetail}:
   * one repository/one node GraphQL query, `--jq` down to the PR node, null → not
   * found. Guards `org`/`name` with {@link GITHUB_NAME_RE} since they are
   * interpolated into the query.
   */
  async fetchPullRequestDetail(org: string, name: string, number: number): Promise<GitHubPullRequestDetail> {
    if (!GITHUB_NAME_RE.test(org) || !GITHUB_NAME_RE.test(name)) {
      throw new Error(`Invalid GitHub repository: ${org}/${name}`);
    }

    const query = `{
      repository(owner: "${org}", name: "${name}") {
        nameWithOwner
        pullRequest(number: ${number}) {
          number title body url state isDraft
          headRefName baseRefName isCrossRepository
          author { login }
        }
      }
    }`;

    const { stdout } = await this.execFn('gh', [
      'api', 'graphql',
      '-f', `query=${query}`,
      '--jq', '.data.repository',
    ], { timeout: 15_000 });

    const repo = JSON.parse(stdout) as {
      nameWithOwner: string;
      pullRequest: {
        number: number; title: string; body: string; url: string; state: string; isDraft: boolean;
        headRefName: string; baseRefName: string; isCrossRepository: boolean;
        author: { login: string } | null;
      } | null;
    } | null;

    if (!repo?.pullRequest) throw new Error(`Could not resolve pull request ${org}/${name}#${number}`);
    const pr = repo.pullRequest;

    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? '',
      url: pr.url,
      state: pr.state,
      isDraft: pr.isDraft,
      author: pr.author?.login ?? 'unknown',
      headRefName: pr.headRefName,
      baseRefName: pr.baseRefName,
      isCrossRepository: pr.isCrossRepository,
      nameWithOwner: repo.nameWithOwner,
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

  /**
   * State, draft flag, title, size and URL for a batch of PRs in one GraphQL call.
   * PRs whose owner or name isn't a plain GitHub identifier are skipped; a failed
   * call yields a partial (possibly empty) map, like fetchPRStates.
   */
  async fetchPRDetails(prs: { org: string; name: string; number: number }[]): Promise<Map<string, PRDetails>> {
    const result = new Map<string, PRDetails>();
    const safe = prs.filter((pr) => GITHUB_NAME_RE.test(pr.org) && GITHUB_NAME_RE.test(pr.name));
    if (safe.length === 0) return result;

    const prQueries = safe.map((pr, idx) => {
      return `pr${idx}: repository(owner: "${pr.org}", name: "${pr.name}") {
      pullRequest(number: ${pr.number}) { state isDraft title additions deletions url }
    }`;
    });

    try {
      const query = `{ ${prQueries.join('\n')} }`;
      const { stdout } = await this.execFn('gh', [
        'api', 'graphql',
        '-f', `query=${query}`,
        '--jq', '.data',
      ], { timeout: 15_000 });

      const data = JSON.parse(stdout) as Record<string, { pullRequest: PRDetails | null } | null>;
      safe.forEach((pr, idx) => {
        const details = data[`pr${idx}`]?.pullRequest;
        if (details) result.set(`${pr.org}/${pr.name}#${pr.number}`, details);
      });
    } catch (err) {
      this.logger.warn('Failed to fetch PR details', { error: String(err) });
    }

    return result;
  }

  /**
   * CI status and check counts for many PRs, without the list of checks — what
   * every PR chip on screen needs. One aliased GraphQL call per
   * {@link CI_SUMMARY_BATCH} PRs; a batch that fails is logged and skipped, so
   * the result can be partial. Keys are lowercase `org/name#number`.
   */
  async fetchPRCiSummaries(prs: { org: string; name: string; number: number }[]): Promise<Map<string, PrCiSummary>> {
    const result = new Map<string, PrCiSummary>();
    const safe = prs.filter((pr) => GITHUB_NAME_RE.test(pr.org) && GITHUB_NAME_RE.test(pr.name));

    for (let start = 0; start < safe.length; start += CI_SUMMARY_BATCH) {
      const batch = safe.slice(start, start + CI_SUMMARY_BATCH);
      const prQueries = batch.map((pr, idx) => `pr${idx}: repository(owner: "${pr.org}", name: "${pr.name}") {
      pullRequest(number: ${pr.number}) {
        state isDraft
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 1) {
          checkRunCountsByState { state count }
          statusContextCountsByState { state count }
        } } } } }
      }
    }`);

      try {
        const data = await this.graphql<Record<string, { pullRequest: GraphQLCiSummaryNode | null } | null>>(
          `{ ${prQueries.join('\n')} }`,
        );
        batch.forEach((pr, idx) => {
          const node = data[`pr${idx}`]?.pullRequest;
          if (!node) return;
          const ref = prCiRef(pr);
          result.set(ref, toCiSummary(ref, node, node.commits.nodes[0]?.commit.statusCheckRollup?.contexts));
        });
      } catch (err) {
        this.logger.warn('Failed to fetch PR CI summaries', { error: String(err), count: batch.length });
      }
    }

    return result;
  }

  /**
   * One PR's checks (up to 100), mergeability and the repository's allowed
   * merge methods — fetched when its chip's menu opens. Returns null when
   * GitHub has no such PR; throws when the call itself fails.
   */
  async fetchPRCiDetail(pr: { org: string; name: string; number: number }): Promise<PrCiDetail | null> {
    if (!GITHUB_NAME_RE.test(pr.org) || !GITHUB_NAME_RE.test(pr.name)) {
      throw new Error(`Invalid GitHub repository: ${pr.org}/${pr.name}`);
    }

    const query = `{
      repository(owner: "${pr.org}", name: "${pr.name}") {
        mergeCommitAllowed squashMergeAllowed rebaseMergeAllowed viewerDefaultMergeMethod
        pullRequest(number: ${pr.number}) {
          state isDraft title url baseRefName headRefOid mergeable mergeStateStatus
          commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 100) {
            totalCount
            checkRunCountsByState { state count }
            statusContextCountsByState { state count }
            nodes {
              __typename
              ... on CheckRun { name status conclusion detailsUrl startedAt completedAt
                                checkSuite { workflowRun { workflow { name } } } }
              ... on StatusContext { context state targetUrl createdAt }
            }
          } } } } }
        }
      }
    }`;

    const data = await this.graphql<{ repository: GraphQLCiRepoNode | null }>(query);
    const repo = data.repository;
    const node = repo?.pullRequest;
    if (!repo || !node) return null;

    const ref = prCiRef(pr);
    const contexts = node.commits.nodes[0]?.commit.statusCheckRollup?.contexts;
    const checks = (contexts?.nodes ?? []).map(toCheck).filter((c): c is PrCheck => c !== null);

    return {
      ...toCiSummary(ref, node, contexts),
      url: node.url,
      title: node.title,
      baseRefName: node.baseRefName,
      headSha: node.headRefOid,
      checks: sortChecks(checks),
      totalChecks: contexts?.totalCount ?? 0,
      mergeable: node.mergeable,
      mergeStateStatus: node.mergeStateStatus,
      allowedMergeMethods: allowedMergeMethods(repo),
    };
  }

  /**
   * Merge a PR with `gh pr merge`. `--match-head-commit` makes GitHub refuse
   * when the branch moved since the caller looked at it. No `--delete-branch`:
   * gh would try to delete a local branch a Fleex worktree may have checked
   * out. Throws (gh's stderr as message) when gh refuses.
   */
  async mergePR(input: { org: string; name: string; number: number; method: PrMergeMethod; headSha: string }): Promise<void> {
    const { org, name, number, method, headSha } = input;
    if (!GITHUB_NAME_RE.test(org) || !GITHUB_NAME_RE.test(name)) {
      throw new Error(`Invalid GitHub repository: ${org}/${name}`);
    }
    if (!PR_MERGE_METHODS.includes(method)) throw new Error(`Invalid merge method: ${method}`);
    if (!HEAD_SHA_RE.test(headSha)) throw new Error(`Invalid head commit: ${headSha}`);
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid PR number: ${number}`);

    await this.execFn('gh', [
      'pr', 'merge', String(number),
      '--repo', `${org}/${name}`,
      `--${method}`,
      '--match-head-commit', headSha,
    ], { timeout: 60_000 });
  }

  /**
   * Runs a GraphQL query and returns `.data`. `gh api graphql` exits non-zero
   * when the response carries any error — a single deleted PR in an aliased
   * batch is enough — while stdout still holds the data GitHub did resolve, so
   * that data is used when present.
   */
  private async graphql<T>(query: string): Promise<T> {
    const args = ['api', 'graphql', '-f', `query=${query}`, '--jq', '.data'];
    try {
      const { stdout } = await this.execFn('gh', args, { timeout: 15_000 });
      return JSON.parse(stdout) as T;
    } catch (err) {
      const stdout = (err as { stdout?: unknown }).stdout;
      if (typeof stdout === 'string' && stdout.trim() && stdout.trim() !== 'null') {
        try {
          return JSON.parse(stdout) as T;
        } catch { /* fall through to the original error */ }
      }
      throw err;
    }
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

        const issues: GitHubIssue[] = repoData.issues.nodes.map(mapIssueNode);

        const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
        const closedIssues: GitHubIssue[] = repoData.closedIssues.nodes
          .map(mapIssueNode)
          .filter((i) => i.closedAt && i.closedAt >= thirtyDaysAgo);

        results.set(key, {
          pulls,
          issues,
          closedIssues,
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

    // Fetch open issues
    const issueJsonFields = 'number,title,state,author,assignees,labels,comments,createdAt,updatedAt,closedAt';
    const { stdout: issueOut } = await this.execFn('gh', [
      'issue', 'list', '--repo', repoSlug,
      '--json', issueJsonFields,
      '--state', 'open', '--limit', '50',
    ], { timeout: 15_000 });

    const rawIssues = JSON.parse(issueOut) as CliIssue[];
    const issues: GitHubIssue[] = rawIssues.map(mapCliIssue);

    // Fetch recently closed issues (last 30 days), symmetric with the batch/GraphQL path.
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const closedDateStr = thirtyDaysAgo.toISOString().split('T')[0];
    const { stdout: closedIssueOut } = await this.execFn('gh', [
      'issue', 'list', '--repo', repoSlug,
      '--json', issueJsonFields,
      '--state', 'closed', '--limit', '20', '--search', `closed:>${closedDateStr}`,
    ], { timeout: 15_000 });

    const rawClosedIssues = JSON.parse(closedIssueOut) as CliIssue[];
    const closedIssues: GitHubIssue[] = rawClosedIssues.map(mapCliIssue);

    return {
      pulls,
      issues,
      closedIssues,
      mergedPRs,
      openPRsCount: pulls.length,
      openIssuesCount: issues.length,
    };
  }
}

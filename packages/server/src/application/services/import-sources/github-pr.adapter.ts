import type { ResolvedImport, SourceMatch } from '@fleex/shared';
import type { GitHubGraphQLAdapter } from '../../../infrastructure/adapters/github-graphql.adapter.js';
import type { LoggerPort } from '../../ports/logger.port.js';
import type { ImportSourceAdapter } from '../../ports/import-source.port.js';
import { mapGitHubError } from './github-error.js';

/** Normalise GitHub's `OPEN | MERGED | CLOSED` to the lowercase wire form. */
function normalizePrState(state: string): 'open' | 'merged' | 'closed' {
  const s = state.toLowerCase();
  return s === 'merged' || s === 'closed' ? s : 'open';
}

/**
 * Resolves a GitHub pull request into a draft. Unlike the legacy PR backfill,
 * this fetches the PR's title and body from GitHub (a "test this PR" ticket with
 * an empty body is useless), and reports the head branch + fork flag so the
 * composer can offer "branch on top" vs "work directly on the branch".
 */
export class GitHubPrImportAdapter implements ImportSourceAdapter {
  readonly id = 'github_pr' as const;

  constructor(
    private readonly githubGraphql: GitHubGraphQLAdapter,
    private readonly logger: LoggerPort,
  ) {}

  async resolve(match: SourceMatch): Promise<ResolvedImport> {
    const org = String(match.params['org']);
    const name = String(match.params['name']);
    const prNumber = Number(match.params['number']);

    let detail;
    try {
      detail = await this.githubGraphql.fetchPullRequestDetail(org, name, prNumber);
    } catch (err) {
      this.logger.warn('GitHub PR resolution failed', { org, name, prNumber, error: String(err) });
      throw mapGitHubError(err, 'github_pr');
    }

    const sections: string[] = [];
    if (detail.body) sections.push(detail.body);

    const metaLines: string[] = [];
    metaLines.push(`- **Repository**: ${detail.nameWithOwner}`);
    metaLines.push(`- **PR**: #${prNumber}`);
    metaLines.push(`- **State**: ${detail.isDraft ? 'DRAFT' : detail.state}`);
    metaLines.push(`- **Author**: @${detail.author}`);
    metaLines.push(`- **Branch**: ${detail.headRefName} → ${detail.baseRefName}`);
    metaLines.push(`- **URL**: ${detail.url}`);

    sections.push(`\n---\n\n#### GitHub Metadata\n\n${metaLines.join('\n')}`);

    return {
      title: detail.title,
      description: sections.join('\n'),
      tags: [],
      links: [{ type: 'github_pr', ref: match.ref, label: match.label, url: match.url }],
      repo: {
        org,
        name,
        headRefName: detail.headRefName,
        isCrossRepository: detail.isCrossRepository,
        prState: normalizePrState(detail.state),
      },
      suggested: { type: 'review' },
    };
  }
}

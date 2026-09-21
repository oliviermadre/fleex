import type { ResolvedImport, SourceMatch } from '@fleex/shared';
import type { GitHubGraphQLAdapter } from '../../../infrastructure/adapters/github-graphql.adapter.js';
import type { LoggerPort } from '../../ports/logger.port.js';
import type { ImportSourceAdapter } from '../../ports/import-source.port.js';
import { mapGitHubError } from './github-error.js';

/**
 * Resolves a GitHub issue into a draft. The title/description/tags/metadata are
 * byte-for-byte what `ImportGitHubIssueUseCase` used to produce (the footer code
 * was moved here, not rewritten), so tickets imported through the new flow match
 * those imported through the legacy route.
 */
export class GitHubIssueImportAdapter implements ImportSourceAdapter {
  readonly id = 'github_issue' as const;

  constructor(
    private readonly githubGraphql: GitHubGraphQLAdapter,
    private readonly logger: LoggerPort,
  ) {}

  async resolve(match: SourceMatch): Promise<ResolvedImport> {
    const org = String(match.params['org']);
    const name = String(match.params['name']);
    const issueNumber = Number(match.params['number']);

    let detail;
    try {
      detail = await this.githubGraphql.fetchIssueDetail(org, name, issueNumber);
    } catch (err) {
      this.logger.warn('GitHub issue resolution failed', { org, name, issueNumber, error: String(err) });
      throw mapGitHubError(err, 'github_issue');
    }

    // Build description: original body + metadata footer (unchanged from the
    // legacy use-case).
    const sections: string[] = [];
    if (detail.body) sections.push(detail.body);

    const metaLines: string[] = [];
    metaLines.push(`- **Repository**: ${org}/${name}`);
    metaLines.push(`- **Issue**: #${issueNumber}`);
    metaLines.push(`- **State**: ${detail.state}`);
    metaLines.push(`- **Author**: @${detail.author}`);
    if (detail.assignees.length > 0) {
      metaLines.push(`- **Assignees**: ${detail.assignees.map((a) => `@${a}`).join(', ')}`);
    }
    if (detail.labels.length > 0) {
      metaLines.push(`- **Labels**: ${detail.labels.join(', ')}`);
    }
    if (detail.milestone) {
      metaLines.push(`- **Milestone**: ${detail.milestone}`);
    }
    metaLines.push(`- **URL**: ${detail.url}`);

    sections.push(`\n---\n\n#### GitHub Metadata\n\n${metaLines.join('\n')}`);

    return {
      title: detail.title,
      description: sections.join('\n'),
      tags: detail.labels ?? [],
      links: [{ type: 'github_issue', ref: match.ref, label: match.label, url: match.url }],
      repo: { org, name },
      githubMetadata: {
        state: detail.state,
        author: detail.author,
        assignees: detail.assignees,
        labels: detail.labels,
        milestone: detail.milestone,
        syncedAt: new Date().toISOString(),
      },
    };
  }
}

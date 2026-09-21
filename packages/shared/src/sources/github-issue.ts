import { GITHUB_NAME_RE, type GitHubImportSourceDescriptor, type SourceMatch } from './types.js';

/**
 * A GitHub issue URL. `http`, a trailing slash, and any query/fragment or
 * sub-path (`/issues/1#issuecomment-…`, `?utm_…`) are tolerated so a link copied
 * from a browser tab still resolves — uniformized on the CLI's leniency.
 */
const ISSUE_URL_RE =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)(?:[/?#]\S*)?$/i;

/**
 * Build the canonical match for an issue. The ref preserves the org/name casing
 * exactly as given (`getTicketsLinkedTo('github_issue', …)` compares strictly).
 */
function fromParts(org: string, name: string, number: number): SourceMatch {
  return {
    sourceId: 'github_issue',
    ref: `${org}/${name}#${number}`,
    url: `https://github.com/${org}/${name}/issues/${number}`,
    label: `#${number}`,
    display: `${org}/${name}#${number}`,
    params: { org, name, number },
  };
}

function detect(input: string): SourceMatch | null {
  const m = ISSUE_URL_RE.exec(input.trim());
  if (!m) return null;
  const [, org, name, num] = m;
  if (!org || !name || !num) return null;
  if (!GITHUB_NAME_RE.test(org) || !GITHUB_NAME_RE.test(name)) return null;
  return fromParts(org, name, Number(num));
}

export const githubIssueSource: GitHubImportSourceDescriptor = {
  id: 'github_issue',
  name: 'GitHub issue',
  resolution: 'instant',
  detect,
  fromParts,
};

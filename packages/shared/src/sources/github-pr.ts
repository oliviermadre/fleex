import { GITHUB_NAME_RE, type GitHubImportSourceDescriptor, type SourceMatch } from './types.js';

/**
 * A GitHub pull-request URL. As lenient as the issue matcher: accepts a
 * sub-path (`/pull/12/files`), a fragment (`#discussion_r…`) and a query
 * (`?utm_…`) — all of which a copied browser link routinely carries.
 */
const PR_URL_RE =
  /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#]\S*)?$/i;

/**
 * Build the canonical match for a PR. Unlike an issue, the ref is LOWERCASED
 * (`org/name#N`) — the hard constraint from the ticket so historical PR links
 * (which mix casings) still resolve through `getTicketsLinkedTo`. `display` and
 * `params` keep the original casing (the latter feeds the GraphQL query).
 */
function fromParts(org: string, name: string, number: number): SourceMatch {
  return {
    sourceId: 'github_pr',
    ref: `${org}/${name}#${number}`.toLowerCase(),
    url: `https://github.com/${org}/${name}/pull/${number}`,
    label: `#${number}`,
    display: `${org}/${name}#${number}`,
    params: { org, name, number },
  };
}

function detect(input: string): SourceMatch | null {
  const m = PR_URL_RE.exec(input.trim());
  if (!m) return null;
  const [, org, name, num] = m;
  if (!org || !name || !num) return null;
  if (!GITHUB_NAME_RE.test(org) || !GITHUB_NAME_RE.test(name)) return null;
  return fromParts(org, name, Number(num));
}

export const githubPrSource: GitHubImportSourceDescriptor = {
  id: 'github_pr',
  name: 'GitHub pull request',
  resolution: 'instant',
  detect,
  fromParts,
};

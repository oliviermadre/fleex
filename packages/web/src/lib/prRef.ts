/**
 * Parse a `github_pr` ticket-link ref into its parts. The canonical ref shape
 * is `"org/name#number"` (the format the PR-state feed is keyed by), so this is
 * reliable even when the link's display `label` is inconsistent
 * (e.g. "PR #209" from detect-merge vs "org/name#204"). Returns null when the
 * ref carries no PR number.
 */
export function parseGithubPrRef(
  ref: string,
): { org: string; name: string; number: number } | null {
  const hash = ref.lastIndexOf('#');
  if (hash < 0) return null;
  const number = Number.parseInt(ref.slice(hash + 1), 10);
  if (!Number.isFinite(number)) return null;
  const repo = ref.slice(0, hash);
  const slash = repo.indexOf('/');
  if (slash <= 0) return { org: '', name: repo, number };
  return { org: repo.slice(0, slash), name: repo.slice(slash + 1), number };
}

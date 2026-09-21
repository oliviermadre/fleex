/** Logins GitHub's GraphQL API reports without the REST `[bot]` suffix. */
const KNOWN_BOTS = new Set(['dependabot', 'renovate', 'github-actions', 'snyk-bot', 'imgbot', 'mergify', 'pre-commit-ci']);

/** Branch prefixes only automation pushes to. */
const BOT_BRANCH_RE = /^(dependabot|renovate|snyk-(fix|upgrade))\//;

/**
 * Is this pull request opened by automation rather than a person? Used to keep
 * dependency bumps out of the way when someone is picking a PR to work on.
 *
 * Deliberately not `login.includes('bot')`: that would hide a human called
 * "robotnik". A login counts only with the `[bot]` suffix, as a known bot, or
 * when the branch name is one only a bot creates.
 */
export function isBotPullRequest(author: string, headRefName: string): boolean {
  const login = author.toLowerCase();
  return login.endsWith('[bot]') || KNOWN_BOTS.has(login) || BOT_BRANCH_RE.test(headRefName);
}

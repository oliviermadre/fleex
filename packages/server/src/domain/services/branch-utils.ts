/** Sanitize a git branch name for use in filesystem paths. */
export function sanitizeBranchForPath(branch: string): string {
  return branch.toLowerCase()
    .replace(/[/_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

/** Build a git branch name for a ticket: ticket/<short-id>-<title-slug> */
export function buildTicketBranchName(title: string, ticketId: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const short = ticketId.slice(0, 6);
  return `ticket/${short}-${slug}`;
}

/** Build the filesystem directory name for a worktree: <repoName>.<sanitized-branch> */
export function buildWorktreeDirName(repoName: string, branchName: string): string {
  return `${repoName}.${sanitizeBranchForPath(branchName)}`;
}

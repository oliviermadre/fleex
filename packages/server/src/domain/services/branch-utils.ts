/** Sanitize a git branch name for use in filesystem paths. */
export function sanitizeBranchForPath(branch: string): string {
  return branch.toLowerCase()
    .replace(/[/_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

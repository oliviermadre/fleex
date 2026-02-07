export interface WorktreeContext {
  org: string;
  repo: string;
  branch: string;
  worktree_path: string;
  branch_slug: string;
  branch_prefix: string;
  branch_suffix: string;
  issue_number: string;
}

export function buildWorktreeContext(
  org: string,
  repo: string,
  branch: string,
  worktreePath: string,
): WorktreeContext {
  const slashIndex = branch.indexOf('/');
  const issueMatch = branch.match(/(\d+)/);

  return {
    org,
    repo,
    branch,
    worktree_path: worktreePath,
    branch_slug: branch.replace(/\//g, '-'),
    branch_prefix: slashIndex !== -1 ? branch.substring(0, slashIndex) : branch,
    branch_suffix: slashIndex !== -1 ? branch.substring(slashIndex + 1) : '',
    issue_number: issueMatch ? issueMatch[1]! : '',
  };
}

export function resolveTemplate(template: string, context: WorktreeContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (key in context) {
      return context[key as keyof WorktreeContext];
    }
    return match;
  });
}

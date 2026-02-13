import { getPipe } from './pipes';

export interface WorktreeContext {
  org: string;
  repo: string;
  branch: string;
  worktree_path: string;
  worktree_name: string;
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
    worktree_name: worktreePath.split('/').pop() || '',
    branch_slug: branch.replace(/\//g, '-'),
    branch_prefix: slashIndex !== -1 ? branch.substring(0, slashIndex) : branch,
    branch_suffix: slashIndex !== -1 ? branch.substring(slashIndex + 1) : '',
    issue_number: issueMatch ? issueMatch[1]! : '',
  };
}

export function parsePipeExpression(expr: string): {
  variable: string;
  pipes: { name: string; args: string[] }[];
} {
  const segments = expr.split('|').map((s) => s.trim());
  const variable = segments[0]!;
  const pipes = segments.slice(1).map((segment) => {
    const match = segment.match(/^(\w+)(?:\(([^)]*)\))?$/);
    if (!match) return { name: segment, args: [] };
    const name = match[1]!;
    const args = match[2] ? match[2].split(',').map((a) => a.trim()) : [];
    return { name, args };
  });
  return { variable, pipes };
}

export function resolveTemplate(template: string, context: WorktreeContext): string {
  return template.replace(/\{\{(.+?)\}\}/g, (match, expr: string) => {
    const { variable, pipes } = parsePipeExpression(expr);

    if (!(variable in context)) {
      return match;
    }

    let value = context[variable as keyof WorktreeContext];

    for (const pipe of pipes) {
      const pipeFn = getPipe(pipe.name);
      if (!pipeFn) return match;
      value = pipeFn.fn(value, ...pipe.args);
    }

    return value;
  });
}

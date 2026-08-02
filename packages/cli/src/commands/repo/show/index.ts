import { printJson } from '../../../core/agentic.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { c, info } from '../../../core/colors.ts';
import { parseRepo, type GitHubIssue, type PullRequest, type Worktree } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface Dashboard {
  org: string;
  name: string;
  openIssues: GitHubIssue[];
  openPullRequests: PullRequest[];
  recentlyMergedPullRequests: PullRequest[];
  worktrees: Worktree[];
  githubUser: string;
  isClonedLocally: boolean;
}

interface ShowOptions {
  json?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  description: 'Show a repository dashboard (PRs, issues, worktrees)',
  setup(cmd) {
    cmd.argument('<org/name>', 'Repository reference');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (repoArg: string, opts: ShowOptions) => {
    const { org, name, slug } = parseRepo(repoArg);
    const d = await apiGet<Dashboard>(`${apiBase()}/api/repositories/${org}/${name}/dashboard`);
    if (opts.json) {
      printJson(d);
      return;
    }
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(slug)}\n`);
    process.stdout.write(`  ${c.dim('cloned')}  ${d.isClonedLocally ? 'yes' : 'no'}\n`);
    process.stdout.write(`  ${c.dim('user')}    ${d.githubUser ?? '-'}\n`);

    process.stdout.write(`\n  ${c.bold('Worktrees')}\n`);
    if (d.worktrees?.length) {
      for (const w of d.worktrees) {
        const tag = w.isMain ? c.dim(' (main)') : '';
        process.stdout.write(`  ${w.branch}${tag}  ${c.dim(w.path)}\n`);
      }
    } else process.stdout.write(`  ${c.dim('(none)')}\n`);

    process.stdout.write(`\n  ${c.bold('Open PRs')}\n`);
    if (d.openPullRequests?.length) {
      for (const pr of d.openPullRequests) {
        const draft = pr.isDraft ? c.dim(' [draft]') : '';
        process.stdout.write(
          `  #${pr.number}  ${pr.title}${draft} ${c.dim(`(${pr.headRefName})`)}\n`,
        );
      }
    } else process.stdout.write(`  ${c.dim('(none)')}\n`);

    process.stdout.write(`\n  ${c.bold('Open issues')}\n`);
    if (d.openIssues?.length) {
      for (const is of d.openIssues) {
        process.stdout.write(`  #${is.number}  ${is.title}\n`);
      }
    } else process.stdout.write(`  ${c.dim('(none)')}\n`);
    process.stdout.write('\n');
    info(`${d.worktrees?.length ?? 0} worktree(s), ${d.openPullRequests?.length ?? 0} open PR(s)`);
  },
};

export default def;

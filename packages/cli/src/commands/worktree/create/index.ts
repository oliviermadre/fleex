import path from 'node:path';
import type { CommandDef } from '../../../core/types.ts';
import { ok, die } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';

interface CreateWorktreeOptions {
  org?: string;
  repo?: string;
  branch?: string;
  baseBranch?: string;
  target?: string;
  createNew?: boolean;
}

const def: CommandDef = {
  name: 'create',
  aliases: ['new'],
  description: 'Create a git worktree on-demand (--org, --repo, --branch required)',
  setup(cmd) {
    cmd.requiredOption('--org <org>', 'Repository organization/owner (required)');
    cmd.requiredOption('--repo <repo>', 'Repository name (required)');
    cmd.requiredOption('--branch <branch>', 'Branch to check out or create (required)');
    cmd.option('--base-branch <baseBranch>', 'Base ref for a new branch (default: origin default branch)');
    cmd.option('--target <path>', 'Target directory (resolved against cwd; default: server-managed path)');
    cmd.option('--create-new', 'Create the branch if it does not exist', false);
  },
  action: async (opts: CreateWorktreeOptions) => {
    if (!opts.org) die('Missing required --org');
    if (!opts.repo) die('Missing required --repo');
    if (!opts.branch) die('Missing required --branch');

    const body: Record<string, unknown> = {
      branch: opts.branch,
      createNewBranch: opts.createNew ?? false,
    };
    if (opts.baseBranch) body.baseBranch = opts.baseBranch;
    // Resolve --target to an absolute path so the server (same host) creates
    // the worktree exactly where the caller expects, regardless of its cwd.
    if (opts.target) body.targetPath = path.resolve(process.cwd(), opts.target);

    const base = apiBase();
    const result = await apiPost<{ path: string; hookStarted: boolean }>(
      `${base}/api/repositories/${encodeURIComponent(opts.org)}/${encodeURIComponent(opts.repo)}/worktrees`,
      body,
    );
    ok(`Worktree ready at ${result.path}${result.hookStarted ? ' (post-checkout hook running)' : ''}`);
  },
};

export default def;

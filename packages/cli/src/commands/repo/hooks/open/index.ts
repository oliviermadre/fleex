import type { CommandDef } from '../../../../core/types.ts';
import { info } from '../../../../core/colors.ts';
import { apiBase, apiPost } from '../../../../core/api.ts';
import { printJson } from '../../../../core/agentic.ts';
import { WORKTREE_OPTION, fetchWorktrees, singleWorktree, worktreeTarget } from '../../_worktree.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'open',
  description: "Open the repo's hooks folder (overlays/<org>/<repo>/hooks) — created if missing",
  setup(cmd) {
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (opts: { worktree?: string; json?: boolean }) => {
    const where = worktreeTarget(opts.worktree);
    const view = singleWorktree((await fetchWorktrees(where)).worktrees, where);
    if (!view.repo) throw new Error(`${view.path} has no resolvable repository (git remote)`);
    const res = await apiPost<{ dir: string }>(`${apiBase()}/api/worktree-actions/hooks/open`, { repo: view.repo });
    if (opts.json) {
      printJson(res);
      return;
    }
    info(res.dir);
  },
};

export default def;

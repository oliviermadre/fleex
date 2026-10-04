import type { WorktreeRunResponse } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, ok } from '../../../../core/colors.ts';
import { apiBase, apiPost } from '../../../../core/api.ts';
import { printJson } from '../../../../core/agentic.ts';
import { WORKTREE_OPTION, fetchWorktrees, singleWorktree, worktreeTarget } from '../../_worktree.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'run',
  description: 'Run a worktree hook now (setup: file hooks then the Setup script; teardown)',
  setup(cmd) {
    cmd.argument('<hook>', 'setup | teardown');
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (hook: string, opts: { worktree?: string; json?: boolean }) => {
    if (hook !== 'setup' && hook !== 'teardown') die('hook must be setup or teardown');
    const where = worktreeTarget(opts.worktree);
    const view = singleWorktree((await fetchWorktrees(where)).worktrees, where);
    const res = await apiPost<WorktreeRunResponse>(`${apiBase()}/api/worktree-actions/hooks/run`, { path: view.path, hook });
    if (opts.json) {
      printJson(res);
      return;
    }
    ok(`${res.alreadyRunning ? 'Already running' : 'Started'} ${hook} in ${view.path} (run ${res.runId}) — its log: GET /api/action-runs/${res.runId}`);
  },
};

export default def;

import chalk from 'chalk';
import type { WorktreeConfigKey } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { ok, warn } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { printJson } from '../../../core/agentic.ts';
import { WORKTREE_OPTION, fetchWorktrees, singleWorktree, worktreeTarget } from '../_worktree.ts';
import { KEYS_HELP, toConfigKey } from '../_keys.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'share',
  description: 'Partager: move personal worktree settings into the repo\'s .fleex/worktree.json (to commit)',
  extraHelp: `\n${KEYS_HELP}\n\n${chalk.dim('$')} fleex repo share action:lint hooks.setup\n`,
  setup(cmd) {
    cmd.argument('<keys...>', 'Config keys to share');
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (keys: string[], opts: { worktree?: string; json?: boolean }) => {
    const where = worktreeTarget(opts.worktree);
    const view = singleWorktree((await fetchWorktrees(where)).worktrees, where);
    const res = await apiPost<{ moved: WorktreeConfigKey[]; file: string }>(`${apiBase()}/api/worktree-actions/share`, { path: view.path, keys: keys.map(toConfigKey) });
    if (opts.json) {
      printJson(res);
      return;
    }
    ok(`Shared ${res.moved.join(', ')} → ${res.file}`);
    warn('Not committed: review and commit it with the rest of your changes.');
  },
};

export default def;

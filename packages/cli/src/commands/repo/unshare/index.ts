import type { WorktreeConfigKey } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { ok, info } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { printJson } from '../../../core/agentic.ts';
import { WORKTREE_OPTION, fetchWorktrees, singleWorktree, worktreeTarget } from '../_worktree.ts';
import { KEYS_HELP, toConfigKey } from '../_keys.ts';

interface Options { worktree?: string; removeFromFile?: boolean; json?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'unshare',
  description: 'Garder pour moi: copy shared worktree settings into your personal Fleex settings',
  extraHelp: `\n${KEYS_HELP}\n\nWithout --remove-from-file the team's copy stays in .fleex/worktree.json; yours masks it.\n`,
  setup(cmd) {
    cmd.argument('<keys...>', 'Config keys to keep for yourself');
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--remove-from-file', 'Also remove them from .fleex/worktree.json');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (keys: string[], opts: Options) => {
    const where = worktreeTarget(opts.worktree);
    const view = singleWorktree((await fetchWorktrees(where)).worktrees, where);
    const res = await apiPost<{ moved: WorktreeConfigKey[] }>(`${apiBase()}/api/worktree-actions/unshare`, { path: view.path, keys: keys.map(toConfigKey), removeFromFile: !!opts.removeFromFile });
    if (opts.json) {
      printJson(res);
      return;
    }
    ok(`Kept for you: ${res.moved.join(', ')}`);
    info(opts.removeFromFile ? 'Removed from .fleex/worktree.json (not committed).' : 'The team copy stays in .fleex/worktree.json; yours masks it.');
  },
};

export default def;

import type { CommandDef } from '../../../core/types.ts';
import { WORKTREE_OPTION } from '../_worktree.ts';
import { setPin } from '../pin/_pin.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'unpin',
  description: 'Unpin a worktree command',
  setup(cmd) {
    cmd.argument('<id>', 'Command id (see fleex repo actions)');
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (id: string, opts: { worktree?: string; json?: boolean }) => setPin(id, false, opts),
};

export default def;

import type { CommandDef } from '../../../core/types.ts';
import { WORKTREE_OPTION } from '../_worktree.ts';
import { setPin } from './_pin.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'pin',
  description: 'Pin a worktree command (★ group at the top of its menu) — personal',
  setup(cmd) {
    cmd.argument('<id>', 'Command id (see fleex repo actions)');
    cmd.option(...WORKTREE_OPTION);
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (id: string, opts: { worktree?: string; json?: boolean }) => setPin(id, true, opts),
};

export default def;

import type { CommandDef } from '../../../../core/types.ts';
import { present } from '../../../../core/colors.ts';
import { printToken, resolveToken } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  access: 'read',
  description: 'Where a ticket (or an item) stands on the floor — its machine, what happens to it there, what it waits for, what can be done with it',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
  },
  action: async (ref: string) => {
    const t = await resolveToken(ref);
    present(t, () => printToken(t));
  },
};

export default def;

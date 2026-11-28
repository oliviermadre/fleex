import type { CommandDef } from '../../../../core/types.ts';
import { present } from '../../../../core/colors.ts';
import { fetchMachine, resolveMachine } from '../../_shared.ts';
import { printMachine } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  access: 'read',
  description: 'One machine — its settings as the layout holds them (spec), its prompt, and the tickets and items standing on it',
  setup(cmd) {
    cmd.argument('<machine>', 'Machine name, id or id prefix');
  },
  action: async (ref: string) => {
    const m = await fetchMachine((await resolveMachine(ref)).id);
    present(m, () => printMachine(m));
  },
};

export default def;

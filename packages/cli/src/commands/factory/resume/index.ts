import type { CommandDef } from '../../../core/types.ts';
import { ok, present } from '../../../core/colors.ts';
import { apiGet, apiPost } from '../../../core/api.ts';
import { fx } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'resume',
  access: 'write',
  description: 'Lift the emergency stop — the floor carries on from where it stood; the runs that were cut start again',
  action: async () => {
    await apiPost(fx('/halt'), { on: false });
    const o = await apiGet<{ halted: boolean; running: number; tickets: number; items: number }>(fx('/overview'));
    present({ halted: o.halted, running: o.running, tickets: o.tickets, items: o.items }, () => ok(o.halted ? 'The floor is stopped. `fleex factory resume` restarts it.' : 'The floor is running.'));
  },
};

export default def;

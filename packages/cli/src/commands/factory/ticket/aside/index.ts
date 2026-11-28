import type { CommandDef } from '../../../../core/types.ts';
import { apiPost } from '../../../../core/api.ts';
import { actOn, enc, fx } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'aside',
  access: 'write',
  description: 'Take a ticket off its station\'s hands — a run in progress is stopped, the ticket stays in the station and frees its place until it is put back',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
  },
  action: async (ref: string) => {
    await actOn(ref, (t) => apiPost(fx(`/tickets/${enc(t.id)}/aside`), {}), 'Set aside');
  },
};

export default def;

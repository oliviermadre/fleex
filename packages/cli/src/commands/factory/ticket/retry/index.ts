import type { CommandDef } from '../../../../core/types.ts';
import { apiPost } from '../../../../core/api.ts';
import { actOn, enc, fx } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'retry',
  access: 'write',
  description: 'Run the station again on a ticket set aside in it — after a failed run, or once its question is answered in the thread',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
  },
  action: async (ref: string) => {
    await actOn(ref, (t) => apiPost(fx(`/tickets/${enc(t.id)}/retry`), {}), 'Back in line for another run');
  },
};

export default def;

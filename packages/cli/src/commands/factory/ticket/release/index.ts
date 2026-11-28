import type { CommandDef } from '../../../../core/types.ts';
import { apiPost } from '../../../../core/api.ts';
import { actOn, enc, fx } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'release',
  access: 'write',
  description: 'Let a ticket (or an item) that waits in a zone leave it — the next arm that wants it takes it out',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
  },
  action: async (ref: string) => {
    await actOn(ref, (t) => apiPost(fx(`/tickets/${enc(t.id)}/release`), {}), 'Released');
  },
};

export default def;

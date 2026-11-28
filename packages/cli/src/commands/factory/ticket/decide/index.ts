import type { CommandDef } from '../../../../core/types.ts';
import { apiPost } from '../../../../core/api.ts';
import { actOn, enc, fx } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'decide',
  access: 'write',
  aliases: ['resolve'],
  description: 'Decide at a human gate — the ticket leaves by the arm of the outcome you give; the decision and its reason are written in its thread in your name',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
    cmd.argument('<outcome>', 'One of the gate\'s outcomes (`fleex factory ticket show` lists them)');
    cmd.option('--reason <text>', 'Why — written in the ticket\'s thread with the decision');
  },
  action: async (ref: string, outcome: string, opts: { reason?: string }) => {
    await actOn(ref, (t) => apiPost(fx(`/tickets/${enc(t.id)}/resolve`), { outcome, ...(opts.reason ? { reason: opts.reason } : {}) }), `Decided "${outcome}"`);
  },
};

export default def;

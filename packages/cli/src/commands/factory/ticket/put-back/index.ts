import type { CommandDef } from '../../../../core/types.ts';
import { apiPost } from '../../../../core/api.ts';
import { actOn, enc, fx } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'put-back',
  access: 'write',
  description: 'Put back a ticket that is set aside in its station (a question, a failed run, or one you took) — run the station again, or with --as send it out by an outcome',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
    cmd.option('--as <outcome>', 'Leave the station by this outcome, as if it had concluded it, instead of running again');
  },
  action: async (ref: string, opts: { as?: string }) => {
    const body = opts.as !== undefined ? { how: 'as', outcome: opts.as } : { how: 'again' };
    await actOn(ref, (t) => apiPost(fx(`/tickets/${enc(t.id)}/put-back`), body), opts.as !== undefined ? `Sent out as "${opts.as}"` : 'Back in line for another run');
  },
};

export default def;

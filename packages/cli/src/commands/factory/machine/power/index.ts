import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { enc, fetchMachine, fx, resolveMachine } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'power',
  access: 'write',
  description: 'Switch a station that runs something off or on — off, it still takes tickets in but starts nothing on them; what already runs finishes',
  setup(cmd) {
    cmd.argument('<machine>', 'Station name, id or id prefix');
    cmd.argument('<state>', 'on or off');
  },
  action: async (ref: string, state: string) => {
    if (state !== 'on' && state !== 'off') die(`Invalid state: ${state} (valid: on, off)`);
    const m = await resolveMachine(ref, ['station']);
    await apiPost(fx(`/machines/${enc(m.id)}/power`), { on: state === 'on' });
    const after = await fetchMachine(m.id);
    present({ id: after.id, name: after.name, off: after.off === true, holds: after.holds }, () =>
      ok(after.off ? `${after.name} is off: it takes tickets in and starts nothing.` : `${after.name} is on.`));
  },
};

export default def;

import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiPatch } from '../../../../core/api.ts';
import { enc, fx, resolveMachine, type MachineDetail } from '../../_shared.ts';
import { SPEC_NOTES, printMachine, specFlags, specFromFlags, type SpecOptions } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'edit',
  access: 'write',
  aliases: ['update'],
  description: 'Change a machine\'s settings — its name, place, prompt, outcomes, conditions…; only what you pass changes, and what stands on it stays',
  setup(cmd) {
    cmd.argument('<machine>', 'Machine name, id or id prefix');
    cmd.option('--x <n>', 'Move it: tile column of its top-left corner');
    cmd.option('--y <n>', 'Move it: tile row of its top-left corner');
    specFlags(cmd);
  },
  extraHelp: `\nNotes:\n${SPEC_NOTES}`,
  action: async (ref: string, opts: SpecOptions) => {
    const patch = specFromFlags(opts);
    if (Object.keys(patch).length === 0) die('Nothing to change — pass at least one flag. See `fleex factory machine edit --help`.');
    const machine = await resolveMachine(ref);
    const after = await apiPatch<MachineDetail>(fx(`/machines/${enc(machine.id)}`), patch);
    present(after, () => { ok(`Updated ${after.name}`); printMachine(after); });
  },
};

export default def;

import type { Routine } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { ok, present } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { resolveRoutine } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'disable',
  description: 'Pause a routine without deleting it — the schedule stops firing',
  setup(cmd) {
    cmd.argument('<slug>', 'Routine slug, name, or UUID');
  },
  action: async (arg: string) => {
    const routine = await resolveRoutine(arg);
    // Disabling clears next_run_at server-side, so a run already in flight is
    // left alone but no new one is scheduled.
    const updated = await apiPatch<Routine>(
      `${apiBase()}/api/routines/${encodeURIComponent(routine.id)}`, { enabled: false },
    );

    present(updated, () => {
      ok(`Paused ${updated.name}`);
    });
  },
};

export default def;

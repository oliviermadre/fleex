import type { CommandDef } from '../../../core/types.ts';
import { c, ok, present } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { resolveRoutine } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'run',
  description: 'Launch a routine now, regardless of its schedule',
  setup(cmd) {
    cmd.argument('<slug>', 'Routine slug, name, or UUID');
  },
  action: async (arg: string) => {
    const routine = await resolveRoutine(arg);
    // A 409 (a run is already active on this routine) surfaces as an API error
    // rather than being swallowed: launching twice would race the same worktree.
    const run = await apiPost<{ id: string; status: string }>(
      `${apiBase()}/api/routines/${encodeURIComponent(routine.id)}/run`, {},
    );

    present(run, () => {
      ok(`Launched ${routine.name}`);
      process.stdout.write(`  ${c.dim('run')}  ${run.id}\n`);
    });
  },
};

export default def;

import type { Routine } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, ok, present } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { resolveRoutine } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'enable',
  description: 'Resume a paused routine — re-armed from now, not from the slot it missed',
  setup(cmd) {
    cmd.argument('<slug>', 'Routine slug, name, or UUID');
  },
  action: async (arg: string) => {
    const routine = await resolveRoutine(arg);
    // Re-enabling recomputes next_run_at server-side: a routine paused for a
    // week must not fire once per missed slot the moment it comes back.
    const updated = await apiPatch<Routine>(
      `${apiBase()}/api/routines/${encodeURIComponent(routine.id)}`, { enabled: true },
    );

    present(updated, () => {
      ok(`Enabled ${updated.name}`);
      process.stdout.write(`  ${c.dim('next run')}  ${updated.nextRunAt ?? '- (manual trigger)'}\n`);
    });
  },
};

export default def;

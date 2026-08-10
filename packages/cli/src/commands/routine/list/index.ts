import type { CommandDef } from '../../../core/types.ts';
import { info, present } from '../../../core/colors.ts';
import { renderTable, trunc } from '../../../core/agentic.ts';
import { fetchRoutines, shortTrigger } from '../_shared.ts';

interface ListOptions { enabled?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List routines with their schedule, next run and current state',
  setup(cmd) {
    cmd.option('--enabled', 'Only show enabled routines');
  },
  action: async (opts: ListOptions) => {
    const all = await fetchRoutines();
    const routines = opts.enabled ? all.filter((r) => r.enabled) : all;

    present(routines, () => {
      if (routines.length === 0) {
        info('No routines yet.');
        return;
      }
      const rows = routines.map((r) => [
        r.slug,
        trunc(`${r.emoji ? r.emoji + ' ' : ''}${r.name}`, 28),
        trunc(shortTrigger(r.trigger, r.webhookEnabled), 18),
        r.nextRunAt ?? '-',
        r.enabled ? 'yes' : 'paused',
        // The active run is what makes "waiting" actionable from a terminal:
        // a routine blocked on a human gate is otherwise indistinguishable from
        // one that simply has not fired yet.
        r.awaitingAttention ? 'waiting' : (r.activeRunStatus ?? '-'),
      ]);
      renderTable(['SLUG', 'NAME', 'TRIGGER', 'NEXT RUN', 'ENABLED', 'RUN'], rows);
      info(`${routines.length} routine(s)`);
    });
  },
};

export default def;

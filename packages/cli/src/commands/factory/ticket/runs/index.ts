import type { CommandDef } from '../../../../core/types.ts';
import { info, present } from '../../../../core/colors.ts';
import { apiGet } from '../../../../core/api.ts';
import { resolveAnyTicketUuid } from '../../../ticket/_shared.ts';
import { enc, fx } from '../../_shared.ts';
import { renderRuns, type RunRow } from '../../runs/index.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'runs',
  access: 'read',
  description: 'The station visits of a ticket — each run with its status, outcome and what failed; also for a ticket that has left the floor',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or UUID');
  },
  action: async (ref: string) => {
    // Not resolved against the floor: what a ticket did there is still asked for once it has shipped.
    const ticketId = await resolveAnyTicketUuid(ref);
    const runs = await apiGet<RunRow[]>(fx(`/tickets/${enc(ticketId)}/runs`));
    present(runs, () => {
      if (runs.length === 0) { info('No station has run on this ticket.'); return; }
      renderRuns(runs);
    });
  },
};

export default def;

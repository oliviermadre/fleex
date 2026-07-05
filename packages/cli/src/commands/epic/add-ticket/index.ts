import type { CommandDef } from '../../../core/types.ts';
import { ok } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { resolveEpic } from '../_shared.ts';
import { resolveTicketId } from '../../ticket/_shared.ts';

interface AddTicketOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'add-ticket',
  description: 'Add a ticket to an epic (add-ticket <epic> <ticket>)',
  setup(cmd) {
    cmd.argument('<epic>', 'Epic UUID or 8-char prefix');
    cmd.argument('<ticket>', 'Ticket display ID (#42) or UUID');
    cmd.option('--board <id>', 'Board to disambiguate the ticket display ID');
  },
  action: async (epicArg: string, ticketArg: string, opts: AddTicketOptions) => {
    const epic = await resolveEpic(epicArg);
    const ticketId = await resolveTicketId(ticketArg, opts.board);
    await apiPost(`${apiBase()}/api/epics/${epic.id}/tickets/${ticketId}`, {});
    ok(`Added ticket to epic ${epic.emoji ?? ''} ${epic.name}`);
  },
};

export default def;

import type { CommandDef } from '../../../core/types.ts';
import { ok } from '../../../core/colors.ts';
import { apiBase, apiDelete } from '../../../core/api.ts';
import { resolveEpic } from '../_shared.ts';
import { resolveTicketId } from '../../ticket/_shared.ts';

interface RemoveTicketOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'remove-ticket',
  aliases: ['rm-ticket'],
  description: 'Remove a ticket from an epic (remove-ticket <epic> <ticket>)',
  setup(cmd) {
    cmd.argument('<epic>', 'Epic UUID or 8-char prefix');
    cmd.argument('<ticket>', 'Ticket display ID (#42) or UUID');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (epicArg: string, ticketArg: string, opts: RemoveTicketOptions) => {
    const epic = await resolveEpic(epicArg);
    const ticketId = await resolveTicketId(ticketArg, opts.board);
    await apiDelete(`${apiBase()}/api/epics/${epic.id}/tickets/${ticketId}`);
    ok(`Removed ticket from epic ${epic.emoji ?? ''} ${epic.name}`);
  },
};

export default def;

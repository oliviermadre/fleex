import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, present } from '../../../core/colors.ts';
import { resolveAnyTicketUuid } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface ArchiveResult {
  displayId: number;
  title: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'unarchive',
  description: 'Restore an archived ticket (unarchive <id>)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
  },
  action: async (idArg: string) => {
    const uuid = await resolveAnyTicketUuid(idArg);
    const ticket = await apiPost<ArchiveResult>(`${apiBase()}/api/tickets/${uuid}/unarchive`, {});
    present(ticket, () => ok(`Unarchived ticket #${ticket.displayId} "${ticket.title}"`));
  },
};

export default def;

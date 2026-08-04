import type { CommandDef } from '../../../core/types.ts';
import { ok, present } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { assertValidStatus, resolveTicketId } from '../_shared.ts';

interface MoveOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'move',
  aliases: ['mv'],
  description: 'Change a ticket status (move <id> <status>)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.argument('<status>', 'Target status (backlog|todo|doing|reviewing|done|cancelled)');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (idArg: string, statusArg: string, opts: MoveOptions) => {
    assertValidStatus(statusArg);
    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    const result = await apiPost<{ displayId: number; status: string }>(`${base}/api/tickets/${uuid}/move`, { status: statusArg });
    present(
      { ok: true, ticketId: result.displayId, status: result.status },
      () => ok(`Moved ticket #${result.displayId} to ${result.status}`),
    );
  },
};

export default def;

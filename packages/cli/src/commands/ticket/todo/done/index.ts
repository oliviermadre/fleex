import type { CommandDef } from '../../../../core/types.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, BOARD_OPTION, changeState } from '../_shared.ts';

interface Options { board?: string; as?: string; reason?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'done',
  aliases: ['check'],
  description: "Mark one or several items of the ticket's todo list done as you complete them. Idempotent: an item already done is reported, not rewritten.",
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<items...>', 'Item refs (3 or #3) or UUIDs — several at once are fine');
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, items: string[], opts: Options) => {
    await changeState(ticketArg, items, 'done', opts, resolveTicketId);
  },
};

export default def;

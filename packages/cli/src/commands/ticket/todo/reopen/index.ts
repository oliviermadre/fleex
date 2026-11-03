import type { CommandDef } from '../../../../core/types.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, BOARD_OPTION, changeState } from '../_shared.ts';

interface Options { board?: string; as?: string; reason?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'reopen',
  aliases: ['undo', 'uncheck'],
  description: "Reopen done or cancelled todo items (back to open).",
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<items...>', 'Item refs (3 or #3) or UUIDs — several at once are fine');
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, items: string[], opts: Options) => {
    await changeState(ticketArg, items, 'open', opts, resolveTicketId);
  },
};

export default def;

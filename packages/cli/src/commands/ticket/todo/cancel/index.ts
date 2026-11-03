import type { CommandDef } from '../../../../core/types.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, BOARD_OPTION, changeState } from '../_shared.ts';

interface Options { board?: string; as?: string; reason?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'cancel',
  description: "Cancel todo items you will not do, with a reason. Use this — not delete — for items you did not create.",
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<items...>', 'Item refs (3 or #3) or UUIDs — several at once are fine');
    cmd.option('--reason <text>', 'Why it is cancelled (kept in the history, shown under the item)');
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, items: string[], opts: Options) => {
    await changeState(ticketArg, items, 'cancelled', opts, resolveTicketId);
  },
};

export default def;

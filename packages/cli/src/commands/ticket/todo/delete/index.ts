import type { TodoWriteResult } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiCall } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, applyAs, BOARD_OPTION, todosUrl } from '../_shared.ts';

interface Options { board?: string; as?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a todo item you created (it leaves the list; its history stays). Agents cannot delete an item a human created — cancel it instead.',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<item>', 'Item ref (3 or #3) or UUID');
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, item: string, opts: Options) => {
    applyAs(opts);
    const uuid = await resolveTicketId(ticketArg, opts.board);
    let result: TodoWriteResult;
    try {
      result = await apiCall<TodoWriteResult>('DELETE', todosUrl(uuid, item));
    } catch (e) {
      die(e instanceof Error ? e.message.replace(/^HTTP \d+: /, '') : String(e));
    }
    present(result, () => ok(`#${result.item.ref} deleted — its history stays (\`fleex ticket todo history ${ticketArg} ${result.item.ref}\`)`));
  },
};

export default def;

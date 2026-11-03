import type { TodoWriteResult } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, present } from '../../../../core/colors.ts';
import { apiPatch } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, applyAs, BOARD_OPTION, reportWrite, todosUrl } from '../_shared.ts';

interface Options { board?: string; as?: string; after?: string; first?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'move',
  aliases: ['mv'],
  description: 'Reorder a todo item: right after another one, or first.',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<item>', 'Item ref (3 or #3) or UUID');
    cmd.option('--after <ref>', 'Put it right after this item');
    cmd.option('--first', 'Put it at the top of the list');
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, item: string, opts: Options) => {
    if ((opts.after === undefined) === !opts.first) die('Give exactly one of --after <ref> or --first.');
    applyAs(opts);
    const uuid = await resolveTicketId(ticketArg, opts.board);
    const result = await apiPatch<TodoWriteResult>(todosUrl(uuid, item), { after: opts.first ? null : opts.after });
    present(result, () => reportWrite(result, 'moved', 'there'));
  },
};

export default def;

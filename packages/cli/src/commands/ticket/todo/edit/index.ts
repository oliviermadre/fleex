import type { TodoWriteResult } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, present } from '../../../../core/colors.ts';
import { apiPatch } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, applyAs, BOARD_OPTION, reportWrite, todosUrl } from '../_shared.ts';

interface Options { board?: string; as?: string; text?: string; note?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'edit',
  aliases: ['update'],
  description: "Edit the text or the note of a todo item (its state is changed with done / cancel / reopen).",
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<item>', 'Item ref (3 or #3) or UUID');
    cmd.option('--text <text>', 'New text, one line (≤ 500 chars)');
    cmd.option('--note <markdown>', 'New note; "" removes it');
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, item: string, opts: Options) => {
    if (opts.text === undefined && opts.note === undefined) die('Nothing to edit: give --text and/or --note.');
    applyAs(opts);
    const uuid = await resolveTicketId(ticketArg, opts.board);
    const result = await apiPatch<TodoWriteResult>(todosUrl(uuid, item), {
      ...(opts.text !== undefined ? { text: opts.text } : {}),
      ...(opts.note !== undefined ? { note: opts.note } : {}),
    });
    present(result, () => reportWrite(result, 'edited', 'like this'));
  },
};

export default def;

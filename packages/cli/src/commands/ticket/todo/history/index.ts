import type { TicketTodoEvent } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { c, present } from '../../../../core/colors.ts';
import { apiGet } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { BOARD_OPTION, historyLine, todosUrl } from '../_shared.ts';

interface Options { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'history',
  aliases: ['log'],
  description: "Who changed what in the ticket's todo list, when, and from where (web / cli / mcp / agent-api). Newest first; deleted items included.",
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('[item]', 'Only this item (ref or UUID)');
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, item: string | undefined, opts: Options) => {
    const uuid = await resolveTicketId(ticketArg, opts.board);
    const query = item !== undefined ? `?itemId=${encodeURIComponent(item.replace(/^#/, ''))}` : '';
    const events = await apiGet<TicketTodoEvent[]>(`${todosUrl(uuid)}/events${query}`);
    present(events, () => {
      if (events.length === 0) {
        process.stdout.write(`${c.dim('No todo history on this ticket.')}\n`);
        return;
      }
      process.stdout.write('\n');
      for (const e of events) process.stdout.write(`${historyLine(e, item === undefined)}\n`);
      process.stdout.write('\n');
    });
  },
};

export default def;

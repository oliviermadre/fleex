import type { Ticket, TicketTodoItem } from '@fleex/shared';
import { TODO_ITEM_STATES } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { c, die, present } from '../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { BOARD_OPTION, countsLine, displayOrder, hasAssignee, isMine, itemLine, todosUrl } from '../_shared.ts';
import { currentActor } from '../../../../core/actor.ts';

interface ListOptions { board?: string; state?: string; mine?: boolean; assignee?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: "List the ticket's shared todo list (open, then done, then cancelled). Read it before starting multi-step work on a ticket; never act on items assigned to the human.",
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.option('--state <state>', 'Only this state: open (alias todo) | done | cancelled');
    cmd.option('--mine', 'Only what is for you: the human\'s items for the human; your own, unassigned and any-agent items for an agent');
    cmd.option('--assignee <who>', 'Only items assigned to: user | agent (any agent) | none | <persona slug>');
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, opts: ListOptions) => {
    const state = opts.state === 'todo' ? 'open' : opts.state;
    if (state !== undefined && !(TODO_ITEM_STATES as readonly string[]).includes(state)) {
      die(`Invalid state: ${opts.state} (valid: open, todo, done, cancelled)`);
    }
    const uuid = await resolveTicketId(ticketArg, opts.board);
    const [ticket, all] = await Promise.all([
      apiGet<Ticket>(`${apiBase()}/api/tickets/${uuid}`),
      apiGet<TicketTodoItem[]>(todosUrl(uuid)),
    ]);
    const actor = currentActor();
    const items = all
      .filter((i) => !state || i.state === state)
      .filter((i) => !opts.mine || isMine(i, actor))
      .filter((i) => opts.assignee === undefined || hasAssignee(i, opts.assignee));
    present(items, () => {
      if (all.length === 0) {
        process.stdout.write(`${c.dim(`No todo on #${ticket.displayId}. Add one: fleex ticket todo add ${ticket.displayId} "…"`)}\n`);
        return;
      }
      process.stdout.write(`\n  ${c.bold(`Todo — #${ticket.displayId} « ${ticket.title} »`)}   ${c.dim(countsLine(all))}\n`);
      for (const i of displayOrder(items)) process.stdout.write(`${itemLine(i)}\n`);
      if (items.length === 0) process.stdout.write(`  ${c.dim('(nothing matches)')}\n`);
      process.stdout.write('\n');
    });
  },
};

export default def;

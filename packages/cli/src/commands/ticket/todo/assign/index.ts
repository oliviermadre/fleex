import type { TodoWriteResult } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, err, ok, info, present, warn } from '../../../../core/colors.ts';
import { apiCall } from '../../../../core/api.ts';
import { currentActor } from '../../../../core/actor.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, applyAs, assigneeLabel, BOARD_OPTION, otherAgentOf, todosUrl } from '../_shared.ts';

interface Options { board?: string; as?: string; reason?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'assign',
  description:
    'Say who todo items are for: me, user (the human), agent (any agent), none (anyone) or a persona slug. '
    + 'Hand to the human (user) what only they can do. Take over items assigned to the human only when the human '
    + 'explicitly asked you to in this request — never just to be able to complete them; that takes --reason.',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<items-and-who...>', 'Item refs (3 or #3) or UUIDs, then who: me | user | agent | none | <persona slug>');
    cmd.option('--reason <text>', "Why — required to take over the human's item (quote or summarise their request)");
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, args: string[], opts: Options) => {
    if (args.length < 2) die('Give one or more item refs, then who: fleex ticket todo assign 42 3 user');
    applyAs(opts);
    const who = args[args.length - 1]!;
    const refs = args.slice(0, -1);
    const uuid = await resolveTicketId(ticketArg, opts.board);
    const results: TodoWriteResult[] = [];
    const failures: string[] = [];
    for (const ref of refs) {
      try {
        results.push(await apiCall<TodoWriteResult>('PATCH', todosUrl(uuid, ref), {
          assignee: who,
          ...(opts.reason !== undefined ? { reason: opts.reason } : {}),
        }));
      } catch (e) {
        failures.push(`#${ref.replace(/^#/, '')}: ${e instanceof Error ? e.message.replace(/^HTTP \d+: /, '') : String(e)}`);
      }
    }
    present(results.length === 1 && failures.length === 0 ? results[0] : { results, failures }, () => {
      for (const r of results) {
        const to = r.item.assignee ? assigneeLabel(r.item.assignee).slice(2) : 'anyone';
        if (r.history.length === 0) info(`#${r.item.ref} already assigned to ${to} — nothing written`);
        else ok(`#${r.item.ref} assigned to ${to}`);
        const other = r.history.length > 0 ? otherAgentOf(r.item, currentActor()) : null;
        if (other) warn(`#${r.item.ref} is now ${other}'s — tell them (comment on the ticket)`);
      }
      for (const f of failures) err(f);
    });
    if (failures.length > 0) process.exit(1);
  },
};

export default def;

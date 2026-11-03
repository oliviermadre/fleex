import { readFileSync } from 'node:fs';
import type { TodoWriteResult } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { die, ok, present } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import { addAsOption, applyAs, BOARD_OPTION, linesToItems, todosUrl } from '../_shared.ts';

interface AddOptions { board?: string; note?: string; after?: string; file?: string; as?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'add',
  aliases: ['create', 'new'],
  description: "Add one or more items to the ticket's shared todo list. Use it to lay out a multi-step plan the human and the next agents can follow.",
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('[text]', 'The item, one line (≤ 500 chars). Omit it with --file');
    cmd.option('--note <markdown>', 'Optional detail shown under the item (≤ 4000 chars)');
    cmd.option('--after <ref>', 'Insert right after this item (default: end of the list)');
    cmd.option('--file <path>', 'Add one item per non-empty line of this file, in order');
    addAsOption(cmd);
    cmd.option(...BOARD_OPTION);
  },
  action: async (ticketArg: string, text: string | undefined, opts: AddOptions) => {
    applyAs(opts);
    let texts: string[];
    if (opts.file !== undefined) {
      if (text !== undefined) die('Use either a text argument or --file, not both.');
      try {
        texts = linesToItems(readFileSync(opts.file, 'utf8'));
      } catch (e) {
        die(`Cannot read --file ${opts.file}: ${e instanceof Error ? e.message : String(e)}`);
      }
      if (texts.length === 0) die(`--file ${opts.file} has no non-empty line.`);
      if (opts.note !== undefined) die('--note applies to a single item; it cannot be combined with --file.');
    } else {
      if (text === undefined || text.trim() === '') die('Give the item text, or --file <path>.');
      texts = [text];
    }

    const uuid = await resolveTicketId(ticketArg, opts.board);
    const created: TodoWriteResult[] = [];
    let after: string | undefined = opts.after;
    for (const t of texts) {
      const result = await apiPost<TodoWriteResult>(todosUrl(uuid), {
        text: t,
        ...(opts.note !== undefined ? { note: opts.note } : {}),
        ...(after !== undefined ? { after } : {}),
      });
      created.push(result);
      // Keep a bulk insert in file order when it starts after an item.
      if (after !== undefined) after = String(result.item.ref);
    }
    const items = created.map((r) => r.item);
    present(items.length === 1 ? items[0] : items, () => {
      for (const i of items) ok(`#${i.ref} added — ${i.text}`);
    });
  },
};

export default def;

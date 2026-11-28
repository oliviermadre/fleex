import type { CommandDef } from '../../../../core/types.ts';
import { die, info, present } from '../../../../core/colors.ts';
import { renderTable, trunc } from '../../../../core/agentic.ts';
import { fetchTokens, refOf, since } from '../../_shared.ts';
import { ITEM_SOURCES } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  access: 'read',
  aliases: ['ls'],
  description: 'List the items on the floor — source, who from, where each stands, what it waits for',
  setup(cmd) {
    cmd.option('--source <source>', `Only this source (${ITEM_SOURCES.join(', ')})`);
    cmd.option('--needs', 'Only those that wait for someone');
  },
  action: async (opts: { source?: string; needs?: boolean }) => {
    if (opts.source !== undefined && !ITEM_SOURCES.includes(opts.source as typeof ITEM_SOURCES[number])) die(`Invalid source: ${opts.source} (valid: ${ITEM_SOURCES.join(', ')})`);
    const items = (await fetchTokens()).filter((t) => t.kind === 'item' && (!opts.source || t.source === opts.source) && (!opts.needs || t.need));
    present(items, () => {
      if (items.length === 0) { info('No item on the floor. `fleex factory item archived` lists those that left.'); return; }
      renderTable(['REF', 'SOURCE', 'FROM', 'TITLE', 'WHERE', 'STATE', 'FOR'], items.map((t) => [
        refOf(t), t.source ?? '-', trunc(t.author ?? '', 20), trunc(t.title, 40), trunc(t.where, 20), trunc(t.state, 36), since(t.since),
      ]));
      info(`${items.length} item(s)`);
    });
  },
};

export default def;

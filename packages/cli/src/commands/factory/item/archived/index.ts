import type { CommandDef } from '../../../../core/types.ts';
import { info, present } from '../../../../core/colors.ts';
import { apiGet } from '../../../../core/api.ts';
import { renderTable, trunc } from '../../../../core/agentic.ts';
import { fx, parseInteger, since } from '../../_shared.ts';

interface Archived { itemId: string; source: string; title: string; author: string; reason: 'junk' | 'exit' | 'dropped' | null; exitId: string | null; intakeId: string | null; archivedAt: string | null }
const HOW = { junk: 'by hand', exit: 'by an exit', dropped: 'dropped by a rule' } as const;

const def: CommandDef = {
  workspaceAware: true,
  name: 'archived',
  access: 'read',
  description: 'The items archived over the last days, latest first — by hand, by an exit, or dropped by an intake rule (hidden unless --dropped)',
  setup(cmd) {
    cmd.option('--days <n>', 'How many days back (1 to 90, default 7)');
    cmd.option('--dropped', 'Also list what intake rules dropped before it reached the floor');
  },
  action: async (opts: { days?: string; dropped?: boolean }) => {
    const days = opts.days !== undefined ? parseInteger(opts.days, '--days') : 7;
    const all = (await apiGet<{ items: Archived[] }>(fx(`/items/archived?days=${days}`))).items;
    // Light rows: the route also carries each item's text and fields, which `item show` gives one at a time.
    const items = all.filter((i) => opts.dropped || i.reason !== 'dropped')
      .map(({ itemId, source, title, author, reason, exitId, intakeId, archivedAt }) => ({ itemId, source, title, author, reason, exitId, intakeId, archivedAt }));
    present(items, () => {
      if (items.length === 0) { info(`No item archived in the last ${days} day(s).`); return; }
      renderTable(['REF', 'SOURCE', 'FROM', 'TITLE', 'LEFT', 'HOW'], items.map((i) => [
        i.itemId.slice(0, 8), i.source, trunc(i.author, 20), trunc(i.title, 44), `${since(i.archivedAt)} ago`, i.reason ? HOW[i.reason] : '-',
      ]));
      info(`${items.length} archived item(s) — \`fleex factory item bring-back <ref>\` puts one back`);
    });
  },
};

export default def;

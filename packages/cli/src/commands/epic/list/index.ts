import type { CommandDef } from '../../../core/types.ts';
import { c, info } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { epicStatusColor, timeframeOrder } from '../_shared.ts';

interface Epic {
  id: string;
  name: string;
  emoji?: string;
  timeframe?: string | null;
  groupStatus?: string;
}

interface ListOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List epics (sorted by timeframe now → next → later)',
  setup(cmd) {
    cmd.option('--board <id>', 'Filter by board ID');
  },
  action: async (opts: ListOptions) => {
    const base = apiBase();
    const url = opts.board ? `${base}/api/epics?boardId=${encodeURIComponent(opts.board)}` : `${base}/api/epics`;
    const epics = await apiGet<Epic[]>(url);
    if (epics.length === 0) {
      info('No epics found.');
      return;
    }
    epics.sort((a, b) => {
      const ta = timeframeOrder(a.timeframe);
      const tb = timeframeOrder(b.timeframe);
      if (ta !== tb) return ta - tb;
      return (a.name ?? '').localeCompare(b.name ?? '');
    });

    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold('ID         Status      Timeframe   Emoji  Name')}\n`);
    process.stdout.write('  ──────────  ───────────  ───────────  ──────  ─────────────────────────────\n');
    for (const e of epics) {
      const id = e.id.slice(0, 8);
      const gstatus = e.groupStatus ?? 'active';
      const colored = epicStatusColor(gstatus)(gstatus.padEnd(11));
      const tf = (e.timeframe ?? '-').padEnd(11);
      const emoji = (e.emoji ?? '-').padEnd(6);
      process.stdout.write(`  ${id.padEnd(10)} ${colored} ${tf} ${emoji} ${e.name}\n`);
    }
    process.stdout.write('\n');
    info(`${epics.length} epic(s)`);
  },
};

export default def;

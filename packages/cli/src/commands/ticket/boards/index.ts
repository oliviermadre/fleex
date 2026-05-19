import type { CommandDef } from '../../../core/types.ts';
import { c, info } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';

interface Board {
  id: string;
  name: string;
  emoji?: string;
  ticketCounts?: Partial<Record<'backlog' | 'todo' | 'doing' | 'reviewing' | 'done' | 'cancelled', number>>;
}

const def: CommandDef = {
  name: 'boards',
  description: 'List boards with ticket counts per status',
  action: async () => {
    const base = apiBase();
    const boards = await apiGet<Board[]>(`${base}/api/boards`);
    if (boards.length === 0) {
      info('No boards found.');
      return;
    }
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold('Board                       Backlog   Todo  Doing Review   Done  Canc.  ID')}\n`);
    process.stdout.write('  ──────────────────────────  ───────  ─────  ───── ──────  ─────  ─────  ────────────────────────────────────\n');
    for (const b of boards) {
      const label = `${b.emoji ?? ''} ${b.name}`.trim().slice(0, 26).padEnd(26);
      const cnt = b.ticketCounts ?? {};
      const n = (k: keyof typeof cnt) => String(cnt[k] ?? 0).padStart(6);
      process.stdout.write(`  ${label} ${n('backlog')}  ${n('todo')}  ${n('doing')} ${n('reviewing')}  ${n('done')}  ${n('cancelled')}  ${c.dim(b.id)}\n`);
    }
    process.stdout.write('\n');
  },
};

export default def;

import type { CommandDef } from '../../../../core/types.ts';
import { c, info, present } from '../../../../core/colors.ts';
import { apiGet } from '../../../../core/api.ts';
import { enc, fx, since } from '../../_shared.ts';
import type { RunRow } from '../../runs/index.ts';
import { resolveItemId } from '../_resolve.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'runs',
  access: 'read',
  description: 'What stations did with an item and what they answered, oldest first — an item has no thread, so this is where a station\'s reply is read',
  setup(cmd) {
    cmd.argument('<item>', 'Item id, or the start of it (on the floor or archived)');
  },
  action: async (ref: string) => {
    const runs = await apiGet<RunRow[]>(fx(`/items/${enc(await resolveItemId(ref))}/runs`));
    present(runs, () => {
      if (runs.length === 0) { info('No station has run on this item.'); return; }
      for (const r of runs) {
        process.stdout.write(`${c.bold(r.machineName)} ${c.dim(`${r.executor} · ${since(r.startedAt)} ago`)}  ${r.status}${r.outcome ? ` → ${r.outcome}` : ''}\n`);
        if (r.error) process.stdout.write(`  ${c.red(r.error)}\n`);
        if (r.reply) process.stdout.write(`${r.reply.trim().split('\n').map((l) => `  ${l}`).join('\n')}\n`);
        if (r.deliverableId) process.stdout.write(`  ${c.dim(`deliverable ${r.deliverableId}`)}\n`);
      }
    });
  },
};

export default def;

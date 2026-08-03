import { c, info, present } from '../../../core/colors.ts';
import { fetchDeliverableTypes, typeLine } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List configured deliverable types with usage counts',
  action: async () => {
    const view = await fetchDeliverableTypes();
    present(view, () => {
      if (view.types.length === 0) {
        info('No deliverable types configured.');
        return;
      }
      process.stdout.write('\n');
      process.stdout.write(
        `  ${c.bold('ID                       LABEL                RENDERER   USAGE')}\n`,
      );
      process.stdout.write('  ────────────────────────  ────────────────────  ──────────  ─────\n');
      for (const t of view.types) {
        process.stdout.write(`${typeLine(t, view.usage)}\n`);
      }
      process.stdout.write('\n');
      info(`${view.types.length} type(s)`);
    });
  },
};

export default def;

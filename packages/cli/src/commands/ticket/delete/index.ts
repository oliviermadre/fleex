import readline from 'node:readline/promises';
import type { CommandDef } from '../../../core/types.ts';
import { c, info, ok } from '../../../core/colors.ts';
import { apiBase, apiGet, apiDelete } from '../../../core/api.ts';
import { resolveTicketId } from '../_shared.ts';

interface DeleteOptions {
  board?: string;
  force?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a ticket (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('-f, --force', 'Skip confirmation');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (idArg: string, opts: DeleteOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();

    if (!opts.force) {
      const t = await apiGet<{ displayId: number; title: string }>(`${base}/api/tickets/${uuid}`);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`${c.yellow('[fleex]')} Delete ticket #${t.displayId} "${t.title}"? [y/N] `);
      rl.close();
      if (!/^[yY]/.test(ans.trim())) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${base}/api/tickets/${uuid}`);
    ok('Deleted ticket');
  },
};

export default def;

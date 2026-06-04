import readline from 'node:readline/promises';
import type { CommandDef } from '../../../../core/types.ts';
import { c, info, ok } from '../../../../core/colors.ts';
import { apiBase, apiGet, apiDelete } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import type { DeliverableDTO } from '../_shared.ts';

interface DeleteOptions { board?: string; force?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a deliverable (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<deliverable-id>', 'Deliverable UUID');
    cmd.option('-f, --force', 'Skip confirmation');
    cmd.option('--board <id>', 'Disambiguate by board');
  },
  action: async (ticketIdArg: string, delivId: string, opts: DeleteOptions) => {
    const uuid = await resolveTicketId(ticketIdArg, opts.board);
    const base = apiBase();

    if (!opts.force) {
      const d = await apiGet<DeliverableDTO>(`${base}/api/tickets/${uuid}/deliverables/${delivId}`);
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`${c.yellow('[fleex]')} Delete deliverable "${d.title}" [${d.type}, v${d.version}]? [y/N] `);
      rl.close();
      if (!/^[yY]/.test(ans.trim())) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${base}/api/tickets/${uuid}/deliverables/${delivId}`);
    ok('Deleted deliverable');
  },
};

export default def;

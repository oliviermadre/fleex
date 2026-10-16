import readline from 'node:readline/promises';
import type { CommandDef } from '../../../../core/types.ts';
import { c, info, ok, present } from '../../../../core/colors.ts';
import { apiBase, apiDelete } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';

interface DeleteOptions { board?: string; force?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete an annotation (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<annotation-id>', 'Annotation UUID');
    cmd.option('-f, --force', 'Skip confirmation');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (ticketIdArg: string, annotationId: string, opts: DeleteOptions) => {
    const uuid = await resolveTicketId(ticketIdArg, opts.board);
    if (!opts.force) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`${c.yellow('[fleex]')} Delete annotation ${annotationId}? [y/N] `);
      rl.close();
      if (!/^[yY]/.test(ans.trim())) {
        info('Cancelled.');
        return;
      }
    }
    await apiDelete(`${apiBase()}/api/tickets/${uuid}/annotations/${annotationId}`);
    present({ ok: true, deleted: true, annotationId }, () => ok('Deleted annotation'));
  },
};

export default def;

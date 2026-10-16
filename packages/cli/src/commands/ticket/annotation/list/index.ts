import type { TimelineAnnotation } from '@fleex/shared';
import type { CommandDef } from '../../../../core/types.ts';
import { c, info, present } from '../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';

interface ListOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List the Timeline annotations of a ticket (oldest instant first)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (idArg: string, opts: ListOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    const annotations = await apiGet<TimelineAnnotation[]>(`${apiBase()}/api/tickets/${uuid}/annotations`);
    present(annotations, () => {
      if (annotations.length === 0) {
        info('No annotations on this ticket.');
        return;
      }
      process.stdout.write('\n');
      for (const a of annotations) {
        process.stdout.write(`  ${c.dim(a.id)}  ${c.dim(a.at)}  ${c.bold(a.title)} ${c.dim(`[${a.tone}]`)} by ${c.cyan(a.authorName)}\n`);
      }
      process.stdout.write('\n');
    });
  },
};

export default def;

import type { CommandDef } from '../../../../core/types.ts';
import { c, info } from '../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../core/api.ts';
import { resolveTicketId } from '../../_shared.ts';
import type { DeliverableDTO } from '../_shared.ts';

interface ListOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List deliverables on a ticket',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (idArg: string, opts: ListOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    const deliverables = await apiGet<DeliverableDTO[]>(`${base}/api/tickets/${uuid}/deliverables`);
    if (deliverables.length === 0) {
      info('No deliverables on this ticket.');
      return;
    }
    process.stdout.write('\n');
    for (const d of deliverables) {
      const sc = d.status === 'final' ? c.green : c.yellow;
      process.stdout.write(`  ${c.dim(d.id)}  ${c.bold(d.title)} ${c.dim(`[${d.type}]`)} by ${c.cyan(d.agentName)}  ${sc(d.status)}  ${c.dim(`v${d.version}`)}\n`);
    }
    process.stdout.write('\n');
  },
};

export default def;

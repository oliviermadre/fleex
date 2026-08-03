import { apiBase, apiGet } from '../../../../core/api.ts';
import { c } from '../../../../core/colors.ts';
import { resolveTicketId } from '../../_shared.ts';

import type { CommandDef } from '../../../../core/types.ts';
import type { DeliverableDTO } from '../_shared.ts';

interface ShowOptions {
  board?: string;
  contentOnly?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view', 'get'],
  description: 'Show a single deliverable on a ticket',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<deliverable-id>', 'Deliverable UUID');
    cmd.option('--board <id>', 'Disambiguate by board');
    cmd.option('--content-only', 'Print only the raw content (no header)');
  },
  action: async (ticketIdArg: string, delivId: string, opts: ShowOptions) => {
    const uuid = await resolveTicketId(ticketIdArg, opts.board);
    const base = apiBase();
    const d = await apiGet<DeliverableDTO>(`${base}/api/tickets/${uuid}/deliverables/${delivId}`);

    if (opts.contentOnly) {
      process.stdout.write(d.content);
      if (!d.content.endsWith('\n')) process.stdout.write('\n');
      return;
    }

    const sc = d.status === 'final' ? c.green : c.yellow;
    process.stdout.write('\n');
    process.stdout.write(
      `  ${c.bold(d.title)}  ${c.dim(`[${d.type}]`)}  by ${c.cyan(d.agentName)}  ${sc(d.status)}  ${c.dim(`v${d.version}`)}\n`,
    );
    process.stdout.write(`  ${c.bold('UUID:')}     ${c.dim(d.id)}\n`);
    process.stdout.write(`  ${c.bold('Ticket:')}   ${c.dim(d.ticketId)}\n`);
    process.stdout.write(`  ${c.bold('Created:')}  ${c.dim(d.createdAt)}\n`);
    process.stdout.write(`  ${c.bold('Updated:')}  ${c.dim(d.updatedAt)}\n`);
    process.stdout.write('  ────────────────────────────────────────────────────────\n');
    for (const line of String(d.content).split('\n')) {
      process.stdout.write(`    ${line}\n`);
    }
    process.stdout.write('\n');
  },
};

export default def;

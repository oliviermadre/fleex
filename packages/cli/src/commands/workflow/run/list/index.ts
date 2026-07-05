import type { CommandDef } from '../../../../core/types.ts';
import { c, info, present } from '../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../core/api.ts';
import { resolveTicketId } from '../../../ticket/_shared.ts';
import type { WorkflowRun } from '../../_shared.ts';

interface ListOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List workflow runs for a ticket',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket display ID (#42) or UUID');
    cmd.option('--board <id>', 'Board to disambiguate the ticket display ID');
  },
  action: async (ticketArg: string, opts: ListOptions) => {
    const ticketId = await resolveTicketId(ticketArg, opts.board);
    const runs = await apiGet<WorkflowRun[]>(
      `${apiBase()}/api/workflows/runs?ticketId=${encodeURIComponent(ticketId)}`,
    );
    present(runs, () => {
      if (runs.length === 0) {
        info('No workflow runs for this ticket.');
        return;
      }
      process.stdout.write('\n');
      const header = `${'RUN ID'.padEnd(36)}  ${'STATUS'.padEnd(12)}  ${'WORKFLOW'.padEnd(23)}  STARTED`;
      process.stdout.write(`  ${c.bold(header)}\n`);
      process.stdout.write(`  ${'─'.repeat(36)}  ${'─'.repeat(12)}  ${'─'.repeat(23)}  ${'─'.repeat(20)}\n`);
      for (const r of runs) {
        const id = r.id.padEnd(36);
        const status = (r.status ?? '-').padEnd(12);
        const wf = (r.templateSnapshot?.name ?? '-').slice(0, 23).padEnd(23);
        const started = r.startedAt ?? '-';
        process.stdout.write(`  ${id}  ${status}  ${wf}  ${started}\n`);
      }
      process.stdout.write('\n');
      info(`${runs.length} run(s)`);
    });
  },
};

export default def;

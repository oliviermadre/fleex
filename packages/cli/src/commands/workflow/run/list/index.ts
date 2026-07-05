import type { CommandDef } from '../../../../core/types.ts';
import { c, info, present } from '../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../core/api.ts';
import { resolveTicketId } from '../../../ticket/_shared.ts';

interface WorkflowRun {
  id: string;
  status: string;
  templateSnapshot?: { name?: string };
  currentStepId?: string | null;
  triggeredBy?: string;
  startedAt?: string;
}

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
      process.stdout.write(`  ${c.bold('RUN ID     STATUS        WORKFLOW                 STARTED')}\n`);
      process.stdout.write('  ──────────  ────────────  ───────────────────────  ────────────────────\n');
      for (const r of runs) {
        const id = r.id.slice(0, 8).padEnd(10);
        const status = (r.status ?? '-').padEnd(12);
        const wf = (r.templateSnapshot?.name ?? '-').slice(0, 23).padEnd(23);
        const started = r.startedAt ?? '-';
        process.stdout.write(`  ${id} ${status} ${wf} ${started}\n`);
      }
      process.stdout.write('\n');
      info(`${runs.length} run(s)`);
    });
  },
};

export default def;

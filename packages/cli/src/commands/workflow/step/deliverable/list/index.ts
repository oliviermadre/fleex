import type { CommandDef } from '../../../../../core/types.ts';
import { c, info } from '../../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../../core/api.ts';
import { fetchRunDetail, resolveStepRunId } from '../../../_shared.ts';
import type { DeliverableDTO } from '../../../../ticket/deliverable/_shared.ts';

interface ListOptions { ticket?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List deliverables attached to a step run (list <runId> <stepRunId>)',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID or short id prefix (prefix needs --ticket)');
    cmd.argument('<stepRunId>', 'Step run UUID or short id prefix');
    cmd.option('--ticket <id>', 'Ticket display ID (#42) or UUID — required to resolve a run prefix');
  },
  action: async (runIdArg: string, stepRunIdArg: string, opts: ListOptions) => {
    const detail = await fetchRunDetail(runIdArg, opts.ticket);
    const stepRunId = resolveStepRunId(detail, stepRunIdArg);
    const deliverables = await apiGet<DeliverableDTO[]>(
      `${apiBase()}/api/workflows/runs/${encodeURIComponent(detail.run.id)}` +
        `/steps/${encodeURIComponent(stepRunId)}/deliverables`,
    );
    if (deliverables.length === 0) {
      info('No deliverables on this step run.');
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

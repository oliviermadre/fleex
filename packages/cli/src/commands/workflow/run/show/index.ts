import type { CommandDef } from '../../../../core/types.ts';
import { c, present } from '../../../../core/colors.ts';
import { fetchRunDetail } from '../../_shared.ts';

interface ShowOptions { ticket?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view'],
  description: 'Show a workflow run and its step runs',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID or short id prefix (needs --ticket)');
    cmd.option('--ticket <id>', 'Ticket display ID (#42) or UUID — required to resolve a run prefix');
  },
  action: async (runId: string, opts: ShowOptions) => {
    const detail = await fetchRunDetail(runId, opts.ticket);
    present(detail, () => {
      const { run, stepRuns } = detail;
      const stepName = new Map((run.templateSnapshot?.steps ?? []).map((s) => [s.id, s.name ?? s.id]));
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold(`Workflow run ${run.templateSnapshot?.name ?? ''}`)}\n`);
      process.stdout.write('  ─────────────────────────────────────────────────────────\n');
      process.stdout.write(`  ${c.bold('Status:')}       ${run.status}\n`);
      process.stdout.write(`  ${c.bold('Current step:')} ${run.currentStepId ? stepName.get(run.currentStepId) ?? run.currentStepId : '-'}\n`);
      process.stdout.write(`  ${c.bold('Triggered by:')} ${run.triggeredBy ?? '-'} (${run.triggeredFrom ?? '-'})\n`);
      process.stdout.write(`  ${c.bold('Started:')}      ${run.startedAt ?? '-'}\n`);
      process.stdout.write(`  ${c.bold('Completed:')}    ${run.completedAt ?? '-'}\n`);
      process.stdout.write(`  ${c.bold('UUID:')}         ${c.dim(run.id)}\n`);

      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold(`Step runs (${stepRuns.length}):`)}\n`);
      if (stepRuns.length === 0) {
        process.stdout.write(`    ${c.dim('No step runs')}\n`);
      } else {
        for (const s of stepRuns) {
          const name = stepName.get(s.stepId) ?? s.stepId;
          const res = s.result ? ` → ${s.result}` : '';
          process.stdout.write(`    ${c.dim(s.id)}  ${s.status.padEnd(12)} attempt ${s.attempt}  ${name}${res}\n`);
        }
      }
      process.stdout.write('\n');
    });
  },
};

export default def;

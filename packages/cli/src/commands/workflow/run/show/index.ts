import type { CommandDef } from '../../../../core/types.ts';
import { c, present } from '../../../../core/colors.ts';
import { apiBase, apiGet } from '../../../../core/api.ts';

interface WorkflowRun {
  id: string;
  ticketId: string;
  status: string;
  currentStepId?: string | null;
  triggeredBy?: string;
  triggeredFrom?: string;
  startedAt?: string;
  completedAt?: string | null;
  templateSnapshot?: { name?: string; steps?: { id: string; name?: string }[] };
}

interface StepRun {
  id: string;
  stepId: string;
  attempt: number;
  status: string;
  result?: string | null;
}

interface RunDetail { run: WorkflowRun; stepRuns: StepRun[] }

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view'],
  description: 'Show a workflow run and its step runs',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID');
  },
  action: async (runId: string) => {
    const detail = await apiGet<RunDetail>(`${apiBase()}/api/workflows/runs/${encodeURIComponent(runId)}`);
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
          process.stdout.write(`    ${c.dim(s.id.slice(0, 8))}  ${s.status.padEnd(12)} attempt ${s.attempt}  ${name}${res}\n`);
        }
      }
      process.stdout.write('\n');
    });
  },
};

export default def;

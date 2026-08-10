import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { resolveRoutine, describeTrigger, describeTarget } from '../_shared.ts';

interface RunDetail {
  run: { id: string; status: string; startedAt?: string; completedAt?: string | null };
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  description: 'Show one routine (by slug, name or UUID): subject, trigger, last and next run',
  setup(cmd) {
    cmd.argument('<slug>', 'Routine slug, name, or UUID');
    cmd.option('--runs <n>', 'How many recent runs to list', '5');
  },
  action: async (arg: string, opts: { runs?: string }) => {
    const routine = await resolveRoutine(arg);
    const limit = Math.max(0, parseInt(opts.runs ?? '5', 10) || 0);
    const runs = limit > 0
      ? (await apiGet<RunDetail[]>(`${apiBase()}/api/routines/${encodeURIComponent(routine.id)}/runs`)).slice(0, limit)
      : [];

    present({ routine, runs: runs.map((r) => r.run) }, () => {
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold(`${routine.emoji ? routine.emoji + ' ' : ''}${routine.name}`)}\n`);
      process.stdout.write(`  ${c.dim('slug')}      ${routine.slug}\n`);
      process.stdout.write(`  ${c.dim('id')}        ${routine.id}\n`);
      process.stdout.write(`  ${c.dim('enabled')}   ${routine.enabled ? 'yes' : 'no (paused)'}\n`);
      process.stdout.write(`  ${c.dim('runs')}      ${describeTarget(routine.target)}\n`);
      if (routine.description) process.stdout.write(`  ${c.dim('about')}     ${routine.description}\n`);

      process.stdout.write(`\n  ${c.bold('Trigger')}\n`);
      process.stdout.write(`  ${c.dim('schedule')}  ${describeTrigger(routine.trigger, routine.webhookEnabled)}\n`);
      if (routine.webhookEnabled && routine.webhookSecret) {
        // The URL is a capability: printing it is deliberate (this is where an
        // operator copies it from), but it deserves the password warning.
        process.stdout.write(`  ${c.dim('webhook')}   ${apiBase()}/api/hooks/${routine.webhookSecret}  ${c.dim('(treat as a password)')}\n`);
      }
      process.stdout.write(`  ${c.dim('overlap')}   ${routine.overlapPolicy}\n`);
      process.stdout.write(`  ${c.dim('next run')}  ${routine.nextRunAt ?? '-'}\n`);
      process.stdout.write(`  ${c.dim('last run')}  ${routine.lastRunAt ?? '-'}\n`);

      process.stdout.write(`\n  ${c.bold('Subject')}\n`);
      process.stdout.write(`  ${c.dim('repos')}     ${routine.subject.repos.join(', ') || '- (no workspace)'}\n`);
      if (routine.subject.brief) process.stdout.write(`  ${c.dim('brief')}     ${routine.subject.brief}\n`);

      if (runs.length > 0) {
        process.stdout.write(`\n  ${c.bold('Recent runs')}\n`);
        for (const { run } of runs) {
          process.stdout.write(`  - ${run.id.slice(0, 8)}  ${run.status.padEnd(12)}  ${run.startedAt ?? '-'}\n`);
        }
      }
      process.stdout.write('\n');
      info(`Launch now with: fleex routine run ${routine.slug}`);
    });
  },
};

export default def;

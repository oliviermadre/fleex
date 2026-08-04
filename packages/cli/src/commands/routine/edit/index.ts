import type { Routine } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, die, ok, present } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { fetchWorkflows, workflowHandleName } from '../../../core/agentic.ts';
import { describeTrigger, resolveRoutine } from '../_shared.ts';
import { buildTrigger, parseOverlap } from '../create/index.ts';

interface EditOptions {
  name?: string;
  workflow?: string;
  description?: string;
  repo?: string[];
  brief?: string;
  manual?: boolean;
  cron?: string;
  at?: string;
  tz?: string;
  overlap?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'edit',
  aliases: ['update'],
  description: 'Edit a routine — only the flags you pass change; enable/disable have their own commands',
  setup(cmd) {
    cmd.argument('<slug>', 'Routine slug, name, or UUID');
    cmd.option('--name <text>', 'Rename the routine');
    cmd.option('--workflow <ref>', 'Switch the workflow template (slug, name or UUID)');
    cmd.option('--description <text>', 'Replace the description');
    cmd.option('--repo <org/name...>', 'Replace the repository list (space-separated)');
    cmd.option('--brief <text>', 'Replace the brief (empty string clears it)');
    cmd.option('--manual', 'Drop the schedule — the routine only runs on demand');
    cmd.option('--cron <expr>', 'Reschedule on a cron expression — exclusive with --at/--manual');
    cmd.option('--at <iso>', 'Reschedule as a one-shot (ISO timestamp) — exclusive with --cron/--manual');
    cmd.option('--tz <zone>', 'Timezone for --cron/--at (default: system timezone)');
    cmd.option('--overlap <policy>', 'What a tick fired mid-run does: "skip" (drop) or "queue" (wait)');
  },
  action: async (arg: string, opts: EditOptions) => {
    const routine = await resolveRoutine(arg);

    if (opts.manual && (opts.cron || opts.at || opts.tz)) {
      die('--manual is exclusive with --cron/--at/--tz.');
    }
    const trigger = opts.manual ? ({ kind: 'manual' } as const) : buildTrigger(opts);

    let templateId: string | undefined;
    if (opts.workflow !== undefined) {
      const workflows = await fetchWorkflows();
      const needle = opts.workflow.trim().toLowerCase();
      const found = workflows.find((w) => w.id === opts.workflow)
        ?? workflows.find((w) => workflowHandleName(w).toLowerCase() === needle)
        ?? workflows.find((w) => (w.name ?? '').toLowerCase() === needle);
      if (!found) die(`No workflow matches "${opts.workflow}". Run \`fleex workflow list\` to see them.`);
      templateId = found.id;
    }

    // The PATCH endpoint replaces the subject wholesale (normalizeRunSubject),
    // so a partial change must be merged over the current subject here — else
    // `--brief` alone would silently wipe the repos.
    const subjectTouched = opts.repo !== undefined || opts.brief !== undefined;
    const subject = subjectTouched
      ? {
          ...routine.subject,
          ...(opts.repo !== undefined ? { repos: opts.repo.map((r) => r.trim()).filter(Boolean) } : {}),
          ...(opts.brief !== undefined ? { brief: opts.brief.trim() || undefined } : {}),
        }
      : undefined;

    const changes = {
      ...(opts.name !== undefined ? { name: opts.name } : {}),
      ...(opts.description !== undefined ? { description: opts.description || null } : {}),
      ...(templateId !== undefined ? { templateId } : {}),
      ...(subject !== undefined ? { subject } : {}),
      ...(trigger ? { trigger } : {}),
      ...(parseOverlap(opts.overlap) ? { overlapPolicy: parseOverlap(opts.overlap) } : {}),
    };
    if (Object.keys(changes).length === 0) {
      die('Nothing to change — pass at least one flag. See `fleex routine edit --help`.');
    }

    const updated = await apiPatch<Routine>(
      `${apiBase()}/api/routines/${encodeURIComponent(routine.id)}`, changes,
    );

    present(updated, () => {
      ok(`Updated ${updated.name}`);
      process.stdout.write(`  ${c.dim('handle')}    @routine:${updated.slug}\n`);
      process.stdout.write(`  ${c.dim('schedule')}  ${describeTrigger(updated.trigger)}\n`);
      process.stdout.write(`  ${c.dim('overlap')}   ${updated.overlapPolicy}\n`);
      process.stdout.write(`  ${c.dim('next run')}  ${updated.nextRunAt ?? '- (manual trigger)'}\n`);
    });
  },
};

export default def;

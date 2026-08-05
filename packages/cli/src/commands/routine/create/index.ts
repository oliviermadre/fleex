import type { Routine, RoutineTarget, RoutineTrigger } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, die, ok, present } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { fetchWorkflows, workflowHandleName } from '../../../core/agentic.ts';
import { describeTrigger } from '../_shared.ts';

interface CreateOptions {
  workflow?: string;
  agent?: string;
  skill?: string;
  panel?: string;
  description?: string;
  repo?: string[];
  brief?: string;
  cron?: string;
  at?: string;
  tz?: string;
  overlap?: string;
  disabled?: boolean;
}

/** Resolve a workflow template reference (slug, name or UUID) to its id. */
async function resolveTemplateId(ref: string): Promise<string> {
  const workflows = await fetchWorkflows();
  const needle = ref.trim().toLowerCase();
  const found = workflows.find((w) => w.id === ref)
    ?? workflows.find((w) => workflowHandleName(w).toLowerCase() === needle)
    ?? workflows.find((w) => (w.name ?? '').toLowerCase() === needle);
  if (!found) die(`No workflow matches "${ref}". Run \`fleex workflow list\` to see them.`);
  return found.id;
}

/**
 * Build the routine target from the four exclusive flags. Workflow refs resolve
 * to the template id; agent/skill/panel refs are passed by name — the server
 * validates their existence at write time (404 with the offending ref).
 */
export async function resolveTargetFromFlags(
  opts: { workflow?: string; agent?: string; skill?: string; panel?: string },
): Promise<RoutineTarget | undefined> {
  const given = [opts.workflow, opts.agent, opts.skill, opts.panel].filter((v) => v !== undefined);
  if (given.length > 1) die('--workflow, --agent, --skill and --panel are mutually exclusive.');
  if (opts.workflow !== undefined) return { kind: 'workflow', ref: await resolveTemplateId(opts.workflow) };
  if (opts.agent !== undefined) return { kind: 'agent', ref: opts.agent.trim() };
  if (opts.skill !== undefined) return { kind: 'skill', ref: opts.skill.trim() };
  if (opts.panel !== undefined) return { kind: 'panel', ref: opts.panel.trim() };
  return undefined;
}

/** Build the trigger from the schedule flags. `--cron` and `--at` are exclusive. */
export function buildTrigger(opts: { cron?: string; at?: string; tz?: string }): RoutineTrigger | undefined {
  if (opts.cron && opts.at) die('--cron and --at are mutually exclusive.');
  const timezone = opts.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (opts.cron) return { kind: 'cron', cron: opts.cron, timezone };
  if (opts.at) return { kind: 'once', runAt: opts.at, timezone };
  // --tz alone is meaningless without a schedule; surfaced, not ignored.
  if (opts.tz) die('--tz requires --cron or --at.');
  return undefined; // server default: manual
}

export function parseOverlap(value: string | undefined): 'skip' | 'queue' | undefined {
  if (value === undefined) return undefined;
  if (value !== 'skip' && value !== 'queue') die(`--overlap must be "skip" or "queue", got "${value}".`);
  return value;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  description: 'Create a routine: a named recipe that runs a workflow, agent, skill or panel on a subject and a trigger, no ticket',
  setup(cmd) {
    cmd.argument('<name>', 'Routine name (the slug is derived from it server-side)');
    cmd.option('--workflow <ref>', 'Workflow template to run (slug, name or UUID) — exclusive with --agent/--skill/--panel');
    cmd.option('--agent <name>', 'Agent persona to run (persona name) — exclusive with the other target flags');
    cmd.option('--skill <command>', 'Skill to run (command name) — exclusive with the other target flags');
    cmd.option('--panel <name>', 'Panel to run (panel name) — exclusive with the other target flags');
    cmd.option('--description <text>', 'What this routine is for');
    cmd.option('--repo <org/name...>', 'Repositories the run gets a worktree on (space-separated)');
    cmd.option('--brief <text>', 'Free-form markdown injected into the agent prompt');
    cmd.option('--cron <expr>', 'Cron schedule (5-field expression) — exclusive with --at');
    cmd.option('--at <iso>', 'One-shot schedule (ISO timestamp) — exclusive with --cron');
    cmd.option('--tz <zone>', 'Timezone for --cron/--at (default: system timezone)');
    cmd.option('--overlap <policy>', 'What a tick fired mid-run does: "skip" (drop) or "queue" (wait)');
    cmd.option('--disabled', 'Create the routine paused');
  },
  action: async (name: string, opts: CreateOptions) => {
    const target = await resolveTargetFromFlags(opts);
    if (!target) die('Pass exactly one target: --workflow, --agent, --skill or --panel.');
    const trigger = buildTrigger(opts);
    const subject = {
      repos: (opts.repo ?? []).map((r) => r.trim()).filter(Boolean),
      ...(opts.brief ? { brief: opts.brief } : {}),
    };

    const routine = await apiPost<Routine>(`${apiBase()}/api/routines`, {
      name,
      ...(opts.description !== undefined ? { description: opts.description } : {}),
      target,
      subject,
      ...(trigger ? { trigger } : {}),
      ...(parseOverlap(opts.overlap) ? { overlapPolicy: parseOverlap(opts.overlap) } : {}),
      ...(opts.disabled ? { enabled: false } : {}),
    });

    present(routine, () => {
      ok(`Created ${routine.name}`);
      process.stdout.write(`  ${c.dim('handle')}    @routine:${routine.slug}\n`);
      process.stdout.write(`  ${c.dim('id')}        ${routine.id}\n`);
      process.stdout.write(`  ${c.dim('schedule')}  ${describeTrigger(routine.trigger)}\n`);
      process.stdout.write(`  ${c.dim('next run')}  ${routine.nextRunAt ?? '- (manual trigger)'}\n`);
    });
  },
};

export default def;

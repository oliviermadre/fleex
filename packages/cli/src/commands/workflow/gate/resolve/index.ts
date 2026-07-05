import type { CommandDef } from '../../../../core/types.ts';
import { ok, die } from '../../../../core/colors.ts';
import { apiBase, apiPost } from '../../../../core/api.ts';
import { fetchRunDetail, resolveStepRunId } from '../../_shared.ts';

interface ResolveOptions { outcome?: string; notes?: string; ticket?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'resolve',
  description: 'Resolve a human-gate step (resolve <runId> <stepRunId> --outcome <name>)',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID or short id prefix (needs --ticket)');
    cmd.argument('<stepRunId>', 'Step run UUID or short id prefix (the human_gate step)');
    cmd.requiredOption('--outcome <name>', 'Gate outcome (as declared by the workflow, e.g. approved)');
    cmd.option('--notes <text>', 'Optional notes recorded with the decision');
    cmd.option('--ticket <id>', 'Ticket display ID (#42) or UUID — required to resolve a run prefix');
  },
  action: async (runId: string, stepRunId: string, opts: ResolveOptions) => {
    const outcome = opts.outcome?.trim();
    if (!outcome) die('An --outcome is required to resolve a gate.');
    const detail = await fetchRunDetail(runId, opts.ticket);
    const stepId = resolveStepRunId(detail, stepRunId);
    const body: { outcome: string; notes?: string } = { outcome };
    if (opts.notes !== undefined) body.notes = opts.notes;
    // The API validates the outcome against the workflow's declared gate
    // outcomes and 400s on an invalid one — surfaced verbatim by the api layer.
    await apiPost(
      `${apiBase()}/api/workflows/runs/${encodeURIComponent(detail.run.id)}/steps/${encodeURIComponent(stepId)}/resolve`,
      body,
    );
    ok(`Resolved gate ${stepId.slice(0, 8)} with outcome "${outcome}"`);
  },
};

export default def;

import { describeEdge } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, ok, die } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { fetchRunDetail, resolveStepRunId } from '../_shared.ts';

interface RouteOptions { edge?: string; notes?: string; ticket?: string }

/**
 * Arbitrating an ambiguous route from the terminal.
 *
 * Without `--edge` the command *lists* the candidates instead of failing: the
 * edge ids are internal and nothing else in the CLI surfaces them, so asking for
 * one the user has no way to know would make the command unusable on its own.
 */
const def: CommandDef = {
  workspaceAware: true,
  name: 'route',
  description: 'Pick the branch of a step parked on an ambiguous route (route <runId> <stepRunId> [--edge <id>])',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID or short id prefix (needs --ticket)');
    cmd.argument('<stepRunId>', 'Step run UUID or short id prefix (the step awaiting routing)');
    cmd.option('--edge <id>', 'Edge to follow — omit to list the candidates');
    cmd.option('--notes <text>', 'Optional reason recorded with the decision');
    cmd.option('--ticket <id>', 'Ticket display ID (#42) or UUID — required to resolve a run prefix');
  },
  action: async (runId: string, stepRunId: string, opts: RouteOptions) => {
    const detail = await fetchRunDetail(runId, opts.ticket);
    const stepId = resolveStepRunId(detail, stepRunId);
    const stepRun = detail.stepRuns.find((s) => s.id === stepId);
    if (stepRun && stepRun.status !== 'awaiting_routing') {
      die(`Step run ${stepId.slice(0, 8)} is not awaiting routing (status: ${stepRun.status}).`);
    }

    // The candidates the engine persisted when it paused — never recomputed from
    // the template, which may have been edited since.
    const candidateIds = stepRun?.output?.routing?.candidateEdgeIds ?? [];
    const steps = detail.run.templateSnapshot?.steps ?? [];
    const candidates = (detail.run.templateSnapshot?.edges ?? []).filter((e) => candidateIds.includes(e.id));

    const edgeId = opts.edge?.trim();
    if (!edgeId) {
      process.stdout.write(`\n  ${c.bold('Candidate branches:')}\n`);
      if (candidates.length === 0) {
        process.stdout.write(`    ${c.dim('none recorded — resolve this run from the UI')}\n\n`);
        return;
      }
      for (const e of candidates) {
        process.stdout.write(`    ${c.dim(e.id)}  ${describeEdge(e, steps)}\n`);
      }
      process.stdout.write(`\n  ${c.dim('Re-run with --edge <id> to take one.')}\n\n`);
      return;
    }

    const body: { edgeId: string; notes?: string } = { edgeId };
    if (opts.notes !== undefined) body.notes = opts.notes;
    // The API re-checks the edge against the persisted candidates and 400s on an
    // edge it never offered — surfaced verbatim by the api layer.
    await apiPost(
      `${apiBase()}/api/workflows/runs/${encodeURIComponent(detail.run.id)}/steps/${encodeURIComponent(stepId)}/route`,
      body,
    );
    const chosen = candidates.find((e) => e.id === edgeId);
    ok(`Routed step ${stepId.slice(0, 8)} to ${chosen ? describeEdge(chosen, steps) : edgeId}`);
  },
};

export default def;

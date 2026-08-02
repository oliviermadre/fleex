import { apiBase, apiPost } from '../../../../core/api.ts';
import { ok } from '../../../../core/colors.ts';
import { fetchRunDetail, resolveStepRunId } from '../../_shared.ts';

import type { CommandDef } from '../../../../core/types.ts';

interface RetryOptions {
  ticket?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'retry',
  description: 'Retry a failed step run (retry <runId> <stepRunId>)',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID or short id prefix (needs --ticket)');
    cmd.argument('<stepRunId>', 'Step run UUID or short id prefix to retry');
    cmd.option(
      '--ticket <id>',
      'Ticket display ID (#42) or UUID — required to resolve a run prefix',
    );
  },
  action: async (runId: string, stepRunId: string, opts: RetryOptions) => {
    const detail = await fetchRunDetail(runId, opts.ticket);
    const stepId = resolveStepRunId(detail, stepRunId);
    await apiPost(
      `${apiBase()}/api/workflows/runs/${encodeURIComponent(detail.run.id)}/steps/${encodeURIComponent(stepId)}/retry`,
      {},
    );
    ok(`Retrying step ${stepId.slice(0, 8)}`);
  },
};

export default def;

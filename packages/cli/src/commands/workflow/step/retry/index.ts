import type { CommandDef } from '../../../../core/types.ts';
import { ok } from '../../../../core/colors.ts';
import { apiBase, apiPost } from '../../../../core/api.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'retry',
  description: 'Retry a failed step run (retry <runId> <stepRunId>)',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID');
    cmd.argument('<stepRunId>', 'Step run UUID to retry');
  },
  action: async (runId: string, stepRunId: string) => {
    await apiPost(
      `${apiBase()}/api/workflows/runs/${encodeURIComponent(runId)}/steps/${encodeURIComponent(stepRunId)}/retry`,
      {},
    );
    ok(`Retrying step ${stepRunId.slice(0, 8)}`);
  },
};

export default def;

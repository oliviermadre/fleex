import type { CommandDef } from '../../../../core/types.ts';
import { ok, warn, info, die, c } from '../../../../core/colors.ts';
import { apiBase, apiDelete } from '../../../../core/api.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../../core/prompt.ts';

interface CancelOptions { force?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'cancel',
  description: 'Cancel a workflow run (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (runId: string, opts: CancelOptions) => {
    if (!opts.force) {
      // Cancelling stops any in-flight steps — never do this silently for agents/CI.
      if (!canPrompt()) {
        die(`Refusing to cancel run ${runId.slice(0, 8)} without confirmation. Re-run with -f to force.`);
      }
      warn(`Cancelling workflow run ${runId.slice(0, 8)} stops its in-flight steps.`);
      const confirmed = await promptYesNo(`Cancel run ${runId.slice(0, 8)}?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }
    await apiDelete(`${apiBase()}/api/workflows/runs/${encodeURIComponent(runId)}`);
    ok(`Cancelled workflow run ${c.bold(runId.slice(0, 8))}`);
  },
};

export default def;

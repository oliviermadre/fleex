import { apiBase, apiDelete } from '../../../../core/api.ts';
import { ok, warn, info, die, c } from '../../../../core/colors.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../../core/prompt.ts';
import { fetchRunDetail } from '../../_shared.ts';

import type { CommandDef } from '../../../../core/types.ts';

interface CancelOptions {
  force?: boolean;
  ticket?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'cancel',
  description: 'Cancel a workflow run (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<runId>', 'Workflow run UUID or short id prefix (needs --ticket)');
    cmd.option('-f, --force', 'Skip confirmation');
    cmd.option(
      '--ticket <id>',
      'Ticket display ID (#42) or UUID — required to resolve a run prefix',
    );
  },
  action: async (runId: string, opts: CancelOptions) => {
    // Resolve + verify the run exists BEFORE prompting, so a mistyped/prefix id
    // fails loud up front rather than after the user confirms a cancel that 404s.
    const { run } = await fetchRunDetail(runId, opts.ticket);
    const short = run.id.slice(0, 8);
    if (!opts.force) {
      // Cancelling stops any in-flight steps — never do this silently for agents/CI.
      if (!canPrompt()) {
        die(`Refusing to cancel run ${short} without confirmation. Re-run with -f to force.`);
      }
      warn(`Cancelling workflow run ${short} stops its in-flight steps.`);
      const confirmed = await promptYesNo(`Cancel run ${short}?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }
    await apiDelete(`${apiBase()}/api/workflows/runs/${encodeURIComponent(run.id)}`);
    ok(`Cancelled workflow run ${c.bold(short)}`);
  },
};

export default def;

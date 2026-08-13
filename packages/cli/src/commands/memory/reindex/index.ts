import type { CommandDef } from '../../../core/types.ts';
import { apiPost } from '../../../core/api.ts';
import { info, ok, present } from '../../../core/colors.ts';
import { memoryApi } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'reindex',
  description: 'Walk the whole corpus and index it — safe to re-run, resumes where it left off',
  action: async () => {
    const res = await apiPost<{ started: boolean }>(memoryApi('/reindex'), {});

    present(res, () => {
      ok('Reindex started.');
      // The walk outlives the request, so the command cannot report completion —
      // pointing at the command that can is more useful than a fake progress bar.
      info('It runs in the background. Follow it with `fleex memory status`.');
    });
  },
};

export default def;

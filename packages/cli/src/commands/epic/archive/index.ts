import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, present } from '../../../core/colors.ts';
import { resolveEpic, type Epic } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'archive',
  description: 'Archive an epic (hides it from the active list)',
  setup(cmd) {
    cmd.argument('<id>', 'Epic UUID or 8-char prefix');
  },
  action: async (idArg: string) => {
    const epic = await resolveEpic(idArg);
    const updated = await apiPost<Epic>(`${apiBase()}/api/epics/${epic.id}/archive`, {});
    present(updated, () => ok(`Archived epic ${updated.emoji ?? ''} ${updated.name}`));
  },
};

export default def;

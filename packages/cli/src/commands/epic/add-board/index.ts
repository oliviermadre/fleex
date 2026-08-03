import { apiBase, apiPost } from '../../../core/api.ts';
import { ok } from '../../../core/colors.ts';
import { resolveBoard } from '../../board/_shared.ts';
import { resolveEpic } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'add-board',
  description: 'Link a board to an epic (add-board <epic> <board>)',
  setup(cmd) {
    cmd.argument('<epic>', 'Epic UUID or 8-char prefix');
    cmd.argument('<board>', 'Board name, UUID, or 8-char id prefix');
  },
  action: async (epicArg: string, boardArg: string) => {
    const epic = await resolveEpic(epicArg);
    const board = await resolveBoard(boardArg);
    await apiPost(`${apiBase()}/api/epics/${epic.id}/boards/${board.id}`, {});
    ok(`Linked board ${board.emoji ?? ''} ${board.name} to epic ${epic.emoji ?? ''} ${epic.name}`);
  },
};

export default def;

import type { CommandDef } from '../../../core/types.ts';
import { ok } from '../../../core/colors.ts';
import { apiBase, apiDelete } from '../../../core/api.ts';
import { resolveEpic } from '../_shared.ts';
import { resolveBoard } from '../../board/_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'remove-board',
  aliases: ['rm-board'],
  description: 'Unlink a board from an epic (remove-board <epic> <board>)',
  setup(cmd) {
    cmd.argument('<epic>', 'Epic UUID or 8-char prefix');
    cmd.argument('<board>', 'Board name, UUID, or 8-char id prefix');
  },
  action: async (epicArg: string, boardArg: string) => {
    const epic = await resolveEpic(epicArg);
    const board = await resolveBoard(boardArg);
    // The API refuses to remove the last board or a board with tickets still in
    // the epic (400/409); those messages are surfaced verbatim by the api layer.
    await apiDelete(`${apiBase()}/api/epics/${epic.id}/boards/${board.id}`);
    ok(`Unlinked board ${board.emoji ?? ''} ${board.name} from epic ${epic.emoji ?? ''} ${epic.name}`);
  },
};

export default def;

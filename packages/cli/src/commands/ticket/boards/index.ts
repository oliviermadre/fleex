import type { CommandDef } from '../../../core/types.ts';
import { listBoardsWithCounts } from '../../board/_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'boards',
  description: 'List boards with ticket counts per status (alias of `board list`)',
  action: async () => {
    await listBoardsWithCounts();
  },
};

export default def;

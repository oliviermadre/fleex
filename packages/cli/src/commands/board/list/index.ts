import { listBoardsWithCounts } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List boards with ticket counts per status',
  action: async () => {
    await listBoardsWithCounts();
  },
};

export default def;

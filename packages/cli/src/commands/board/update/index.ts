import type { CommandDef } from '../../../core/types.ts';
import { ok, die, present } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { resolveBoard, type Board } from '../_shared.ts';

interface UpdateOptions { name?: string; emoji?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  aliases: ['rename'],
  description: 'Update a board name and/or emoji (update <board> [--name] [--emoji])',
  setup(cmd) {
    cmd.argument('<board>', 'Board name, UUID, or 8-char id prefix');
    cmd.option('--name <name>', 'New name');
    cmd.option('--emoji <emoji>', 'New emoji/icon');
  },
  action: async (boardArg: string, opts: UpdateOptions) => {
    if (opts.name === undefined && opts.emoji === undefined) {
      die('Nothing to update — pass --name and/or --emoji.');
    }
    const board = await resolveBoard(boardArg);
    const body: { name?: string; emoji?: string } = {};
    if (opts.name !== undefined) {
      const name = opts.name.trim();
      if (!name) die('Board name cannot be empty.');
      body.name = name;
    }
    if (opts.emoji !== undefined) body.emoji = opts.emoji;
    const updated = await apiPatch<Board>(`${apiBase()}/api/boards/${board.id}`, body);
    present(updated, () => ok(`Updated board ${updated.emoji ?? ''} ${updated.name} (${updated.id})`));
  },
};

export default def;

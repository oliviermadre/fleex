import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, die, present } from '../../../core/colors.ts';

import type { CommandDef } from '../../../core/types.ts';
import type { Board } from '../_shared.ts';

interface CreateOptions {
  name?: string;
  emoji?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  description: 'Create a board (create --name "Name" [--emoji 🗺️])',
  setup(cmd) {
    cmd.requiredOption('--name <name>', 'Board name');
    cmd.option('--emoji <emoji>', 'Board emoji/icon');
  },
  action: async (opts: CreateOptions) => {
    const name = opts.name?.trim();
    if (!name) die('Board name cannot be empty.');
    const body: { name: string; emoji?: string } = { name };
    // Pass an explicit --emoji through even if empty, matching `board update`.
    // Omitting --emoji entirely lets the server apply its default icon.
    if (opts.emoji !== undefined) body.emoji = opts.emoji;
    const board = await apiPost<Board>(`${apiBase()}/api/boards`, body);
    present(board, () => ok(`Created board ${board.emoji ?? ''} ${board.name} (${board.id})`));
  },
};

export default def;

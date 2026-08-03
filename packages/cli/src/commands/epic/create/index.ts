import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, die, present } from '../../../core/colors.ts';
import { resolveBoard } from '../../board/_shared.ts';
import { assertValidTimeframe, type Epic } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface CreateOptions {
  name?: string;
  emoji?: string;
  color?: string;
  description?: string;
  timeframe?: string;
  board?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  aliases: ['new'],
  description: 'Create an epic (create --name "Q3 Launch" [--timeframe now] [--board <id>])',
  setup(cmd) {
    cmd.requiredOption('--name <name>', 'Epic name');
    cmd.option('--emoji <emoji>', 'Epic emoji/icon');
    cmd.option('--color <color>', 'Epic color (hex or name)');
    cmd.option('--description <text>', 'Epic description');
    cmd.option('--timeframe <tf>', 'Timeframe: now | next | later');
    cmd.option('--board <board>', 'Associate with a board (name, UUID, or id prefix)');
  },
  action: async (opts: CreateOptions) => {
    const name = opts.name?.trim();
    if (!name) die('Epic name cannot be empty.');
    if (opts.timeframe) assertValidTimeframe(opts.timeframe);

    const body: Record<string, unknown> = { name };
    if (opts.emoji !== undefined) body.emoji = opts.emoji;
    if (opts.color !== undefined) body.color = opts.color;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.timeframe !== undefined) body.timeframe = opts.timeframe;
    if (opts.board) body.boardId = (await resolveBoard(opts.board)).id;

    const epic = await apiPost<Epic>(`${apiBase()}/api/epics`, body);
    present(epic, () =>
      ok(`Created epic ${epic.emoji ?? ''} ${epic.name} (${epic.id.slice(0, 8)})`),
    );
  },
};

export default def;

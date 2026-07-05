import type { CommandDef } from '../../../core/types.ts';
import { ok, die, present } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { assertValidTimeframe, resolveEpic, type Epic } from '../_shared.ts';

interface UpdateOptions {
  name?: string;
  emoji?: string;
  color?: string;
  description?: string;
  timeframe?: string;
  blocked?: boolean;
  favorite?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  aliases: ['edit'],
  description: 'Update an epic (update <id> [--name ...] [--timeframe next] [--blocked] ...)',
  setup(cmd) {
    cmd.argument('<id>', 'Epic UUID or 8-char prefix');
    cmd.option('--name <name>', 'New name');
    cmd.option('--emoji <emoji>', 'New emoji/icon');
    cmd.option('--color <color>', 'New color (hex or name)');
    cmd.option('--description <text>', 'New description');
    cmd.option('--timeframe <tf>', 'Timeframe: now | next | later');
    cmd.option('--blocked', 'Mark as blocked');
    cmd.option('--no-blocked', 'Clear the blocked flag');
    cmd.option('--favorite', 'Mark as favorite');
    cmd.option('--no-favorite', 'Clear the favorite flag');
  },
  action: async (idArg: string, opts: UpdateOptions) => {
    if (opts.timeframe) assertValidTimeframe(opts.timeframe);

    const body: Record<string, unknown> = {};
    if (opts.name !== undefined) body.name = opts.name;
    if (opts.emoji !== undefined) body.emoji = opts.emoji;
    if (opts.color !== undefined) body.color = opts.color;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.timeframe !== undefined) body.timeframe = opts.timeframe;
    if (opts.blocked !== undefined) body.blocked = opts.blocked;
    if (opts.favorite !== undefined) body.favorite = opts.favorite;
    if (Object.keys(body).length === 0) die('Nothing to update. Pass at least one field to change.');

    const epic = await resolveEpic(idArg);
    const updated = await apiPatch<Epic>(`${apiBase()}/api/epics/${epic.id}`, body);
    present(updated, () => ok(`Updated epic ${updated.emoji ?? ''} ${updated.name} (${updated.id.slice(0, 8)})`));
  },
};

export default def;

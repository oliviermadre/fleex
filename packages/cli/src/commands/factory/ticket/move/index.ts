import type { CommandDef } from '../../../../core/types.ts';
import { die } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { actOn, enc, fx, resolveTarget } from '../../_shared.ts';

interface MoveOptions { to?: string; x?: string; y?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'move',
  access: 'write',
  description: 'Put a ticket (or an item) of the floor on another machine, or lay it on a tile — a run in progress keeps going but its result is ignored',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
    cmd.option('--to <machine>', 'The machine to put it on (name, id or id prefix): a station, a zone, a belt, an exit…');
    cmd.option('--x <n>', 'Or the tile to lay it on (with --y)');
    cmd.option('--y <n>', 'Tile row, with --x');
  },
  action: async (ref: string, opts: MoveOptions) => {
    const target = await resolveTarget(opts);
    if (!target) die('Say where: --to <machine>, or --x and --y. `fleex factory machine list` lists the machines.');
    await actOn(ref, (t) => apiPost(fx(`/tickets/${enc(t.id)}/move`), target), 'Moved');
  },
};

export default def;

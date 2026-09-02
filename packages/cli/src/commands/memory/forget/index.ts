import type { CommandDef } from '../../../core/types.ts';
import { apiDelete } from '../../../core/api.ts';
import { die, ok, present } from '../../../core/colors.ts';
import { memoryApi } from '../_shared.ts';

/**
 * Undo a `keep`.
 *
 * A kept note is deliberately ranked above the ambient run output it came from,
 * so keeping the wrong one degrades every later retrieval until it is removed.
 * The id is what `keep` prints.
 */
const def: CommandDef = {
  workspaceAware: true,
  name: 'forget',
  description: 'Remove a kept memory note by id',
  setup(cmd) {
    cmd.argument('<noteId>', 'Note id printed by `fleex memory keep`');
  },
  action: async (noteId: string) => {
    const id = noteId?.trim();
    if (!id) die('A note id is required.');

    await apiDelete(memoryApi(`/curated/${encodeURIComponent(id)}`));
    present({ ok: true, noteId: id }, () => ok('Forgotten.'));
  },
};

export default def;

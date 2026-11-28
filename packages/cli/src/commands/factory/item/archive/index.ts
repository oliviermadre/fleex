import type { CommandDef } from '../../../../core/types.ts';
import { ok, present } from '../../../../core/colors.ts';
import { apiPost } from '../../../../core/api.ts';
import { enc, fx, refOf, resolveToken } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'archive',
  access: 'write',
  description: 'Archive an item of the floor — it is junk, or done with; it leaves the floor, and a new message in its conversation brings it back',
  setup(cmd) {
    cmd.argument('<item>', 'Item id, or the start of it');
  },
  action: async (ref: string) => {
    const t = await resolveToken(ref, 'item');
    await apiPost(fx(`/items/${enc(t.id)}/archive`), {});
    present({ ok: true, id: t.id, title: t.title, archived: true }, () => ok(`Archived item ${refOf(t)}: ${t.title}`));
  },
};

export default def;

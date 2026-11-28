import type { CommandDef } from '../../../../core/types.ts';
import { ok, present } from '../../../../core/colors.ts';
import { apiDelete } from '../../../../core/api.ts';
import { enc, fx, refOf, resolveToken } from '../../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'take-back',
  access: 'write',
  aliases: ['give-back'],
  description: 'Take a ticket back from the Factory — it leaves the floor at once and is an ordinary ticket again, in the status it has (an item is archived instead)',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket number (42, #42) or id; or an item id');
  },
  action: async (ref: string) => {
    const t = await resolveToken(ref);
    await apiDelete(fx(`/tickets/${enc(t.id)}`));
    present({ ok: true, id: t.id, kind: t.kind, displayId: t.displayId, title: t.title, onFloor: false }, () =>
      ok(t.kind === 'item' ? `Archived item ${refOf(t)}: ${t.title}` : `Taken back from the Factory: ${refOf(t)} ${t.title}`));
  },
};

export default def;

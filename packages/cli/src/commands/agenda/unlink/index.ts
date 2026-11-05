import type { CommandDef } from '../../../core/types.ts';
import { die, ok, present } from '../../../core/colors.ts';
import { apiBase } from '../../../core/api.ts';
import { agendaRequest, describeAgendaError } from '../_shared.ts';

const def: CommandDef = {
  workspaceAware: true,
  name: 'unlink',
  description: 'Remove a deliverable ↔ meeting link (unlink <link-id>; ids from `fleex agenda links`)',
  setup(cmd) {
    cmd.argument('<link-id>', 'Link id (see `fleex agenda links`)');
  },
  action: async (linkId: string) => {
    try {
      await agendaRequest('DELETE', `${apiBase()}/api/agenda/external-links/${encodeURIComponent(linkId)}`);
    } catch (err) {
      die(describeAgendaError(err));
    }
    present({ ok: true, deleted: true, linkId }, () => ok(`Unlinked ${linkId}`));
  },
};

export default def;

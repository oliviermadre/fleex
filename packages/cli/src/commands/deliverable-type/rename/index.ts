import { apiBase, apiPost } from '../../../core/api.ts';
import { ok, die, present, c } from '../../../core/colors.ts';
import { resolveDeliverableType, type DeliverableTypesView } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface RenamedView extends DeliverableTypesView {
  migrated: number;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'rename',
  description: 'Rename a deliverable type id, migrating existing deliverables to the new id',
  setup(cmd) {
    cmd.argument('<id>', 'Current deliverable type id');
    cmd.argument('<newId>', 'New deliverable type id (slug)');
  },
  action: async (idArg: string, newIdArg: string) => {
    const type = await resolveDeliverableType(idArg);
    const newId = newIdArg.trim();
    if (!newId) die('New deliverable type id cannot be empty.');

    const view = await apiPost<RenamedView>(
      `${apiBase()}/api/deliverable-types/${type.id}/rename`,
      { newId },
    );
    present(view, () =>
      ok(
        `Renamed ${c.bold(type.id)} → ${c.bold(newId)} (${view.migrated} deliverable(s) migrated)`,
      ),
    );
  },
};

export default def;

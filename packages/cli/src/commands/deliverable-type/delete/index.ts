import { apiBase, apiDelete } from '../../../core/api.ts';
import { ok, warn, info, die, c } from '../../../core/colors.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../core/prompt.ts';
import { resolveDeliverableType } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface DeleteOptions {
  force?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a deliverable type (only when unused; prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<id>', 'Deliverable type id');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (idArg: string, opts: DeleteOptions) => {
    const type = await resolveDeliverableType(idArg);

    if (!opts.force) {
      // Never delete without a human ok in a non-interactive context (agents, CI).
      if (!canPrompt()) {
        die(
          `Refusing to delete deliverable type "${type.id}" without confirmation. Re-run with -f to force.`,
        );
      }
      warn(
        `Deleting deliverable type "${type.id}" removes it from the workspace config. Deliverables still using it will block the delete.`,
      );
      const confirmed = await promptYesNo(`Delete deliverable type "${type.id}"?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${apiBase()}/api/deliverable-types/${type.id}`);
    ok(`Deleted deliverable type ${c.bold(type.id)}`);
  },
};

export default def;

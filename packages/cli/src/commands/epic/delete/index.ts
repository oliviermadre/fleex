import type { CommandDef } from '../../../core/types.ts';
import { ok, warn, info, die, c, present } from '../../../core/colors.ts';
import { apiBase, apiDelete } from '../../../core/api.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../core/prompt.ts';
import { resolveEpic } from '../_shared.ts';

interface DeleteOptions { force?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete an epic (its tickets are kept; prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<id>', 'Epic UUID or 8-char prefix');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (idArg: string, opts: DeleteOptions) => {
    const epic = await resolveEpic(idArg);
    const label = `${epic.emoji ?? ''} ${epic.name}`.trim();

    if (!opts.force) {
      // Never delete without a human ok in a non-interactive context (agents, CI).
      if (!canPrompt()) {
        die(`Refusing to delete epic "${label}" without confirmation. Re-run with -f to force.`);
      }
      warn(`Deleting epic "${label}" removes the grouping (its tickets are kept). This cannot be undone.`);
      const confirmed = await promptYesNo(`Delete epic "${label}"?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${apiBase()}/api/epics/${epic.id}`);
    present({ ok: true, deleted: true, epicId: epic.id }, () => ok(`Deleted epic ${c.bold(label)}`));
  },
};

export default def;

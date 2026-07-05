import type { CommandDef } from '../../../core/types.ts';
import { ok, warn, info, die, c } from '../../../core/colors.ts';
import { apiBase, apiDelete } from '../../../core/api.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../core/prompt.ts';
import { resolveSession } from '../_shared.ts';

interface KillOptions { force?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'kill',
  aliases: ['rm'],
  description: 'Terminate a session (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<id>', 'Session UUID, 8-char prefix, or display name');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (idArg: string, opts: KillOptions) => {
    const session = await resolveSession(idArg);
    const label = `${session.displayName ?? session.id.slice(0, 8)}`;

    if (!opts.force) {
      // Killing a session terminates its tmux process and any running work in it.
      if (!canPrompt()) {
        die(`Refusing to kill session "${label}" without confirmation. Re-run with -f to force.`);
      }
      warn(`Killing session "${label}" terminates its tmux process and anything running in it.`);
      const confirmed = await promptYesNo(`Kill session "${label}"?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${apiBase()}/api/sessions/${session.id}`);
    ok(`Killed session ${c.bold(label)}`);
  },
};

export default def;

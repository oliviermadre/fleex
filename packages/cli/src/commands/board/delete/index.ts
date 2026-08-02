import { apiBase, apiDelete } from '../../../core/api.ts';
import { ok, warn, info, die, c } from '../../../core/colors.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../core/prompt.ts';
import { resolveBoard } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface DeleteOptions {
  force?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a board AND all its tickets (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<board>', 'Board name, UUID, or 8-char id prefix');
    cmd.option('-f, --force', 'Skip confirmation');
  },
  action: async (boardArg: string, opts: DeleteOptions) => {
    const board = await resolveBoard(boardArg);
    const label = `${board.emoji ?? ''} ${board.name}`.trim();

    if (!opts.force) {
      // Deleting a board cascades to every ticket it contains — never do this
      // silently in a non-interactive context (agents, CI). Require -f there.
      if (!canPrompt()) {
        die(
          `Refusing to delete board "${label}" without confirmation. Re-run with -f to force (this also deletes all its tickets).`,
        );
      }
      warn(`Deleting board "${label}" will also delete ALL of its tickets. This cannot be undone.`);
      const confirmed = await promptYesNo(`Delete board "${label}" and its tickets?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    // The API refuses to delete the last remaining board (LastBoardError);
    // that error is surfaced verbatim by the api layer.
    await apiDelete(`${apiBase()}/api/boards/${board.id}`);
    ok(`Deleted board ${c.bold(label)} and its tickets`);
  },
};

export default def;

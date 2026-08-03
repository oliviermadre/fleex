import type { CommandDef } from '../../../../core/types.ts';
import { ok, info, die } from '../../../../core/colors.ts';
import { apiBase, apiDelete } from '../../../../core/api.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../../core/prompt.ts';
import { getMention, mentionLabel } from '../_shared.ts';

interface DeleteOptions { board?: string; force?: boolean }

const def: CommandDef = {
  workspaceAware: true,
  name: 'delete',
  aliases: ['rm'],
  description: 'Delete a mention (prompts unless -f is given)',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket display ID or UUID');
    cmd.argument('<mention>', 'Mention UUID or 8-char id prefix (see `fleex ticket mentions`)');
    cmd.option('-f, --force', 'Skip confirmation');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
  },
  action: async (ticketArg: string, mentionArg: string, opts: DeleteOptions) => {
    const mention = await getMention(ticketArg, mentionArg, opts.board);
    const label = mentionLabel(mention);

    if (!opts.force) {
      if (!canPrompt()) {
        die(`Refusing to delete mention ${label} without confirmation. Re-run with -f to force.`);
      }
      const confirmed = await promptYesNo(`Delete mention ${label} (${mention.id.slice(0, 8)})?`, false);
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${apiBase()}/api/mentions/${mention.id}`);
    ok(`Deleted mention ${label}`);
  },
};

export default def;

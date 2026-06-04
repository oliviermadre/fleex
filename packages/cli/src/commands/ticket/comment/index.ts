import type { CommandDef } from '../../../core/types.ts';
import { ok } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { resolveTicketId } from '../_shared.ts';

interface CommentOptions { board?: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'comment',
  description: 'Add a comment to a ticket (comment <id> "body")',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.argument('<body>', 'Comment body');
    cmd.option('--board <id>', 'Disambiguate by board');
  },
  action: async (idArg: string, bodyArg: string, opts: CommentOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    await apiPost(`${base}/api/tickets/${uuid}/comments`, { body: bodyArg });
    ok(`Comment added to ticket #${idArg}`);
  },
};

export default def;

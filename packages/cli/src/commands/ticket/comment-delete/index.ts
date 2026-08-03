import { apiBase, apiGet, apiDelete } from '../../../core/api.ts';
import { ok, info, err, die, c } from '../../../core/colors.ts';
import { matchById } from '../../../core/match.ts';
import { canPrompt, promptYesNo, closePrompts } from '../../../core/prompt.ts';
import { resolveTicketId } from '../_shared.ts';

import type { CommandDef } from '../../../core/types.ts';

interface Comment {
  id: string;
  authorName: string;
  authorType: string;
  body: string;
}
interface DeleteOptions {
  board?: string;
  force?: boolean;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'comment-delete',
  aliases: ['comment-rm'],
  description: 'Delete a comment from a ticket (comment-delete <ticket> <comment>)',
  setup(cmd) {
    cmd.argument('<ticket>', 'Ticket display ID or UUID');
    cmd.argument('<comment>', 'Comment UUID or 8-char id prefix (see `fleex ticket comments`)');
    cmd.option('-f, --force', 'Skip confirmation');
    cmd.option('--board <id>', 'Disambiguate the ticket by board');
  },
  action: async (ticketArg: string, commentArg: string, opts: DeleteOptions) => {
    const uuid = await resolveTicketId(ticketArg, opts.board);
    const base = apiBase();
    const comments = await apiGet<Comment[]>(`${base}/api/tickets/${uuid}/comments`);

    const result = matchById(comments, commentArg);
    if (result.kind === 'none') {
      die(
        `No comment on this ticket matches "${commentArg}". List them with \`fleex ticket comments ${ticketArg}\`.`,
      );
    }
    if (result.kind === 'ambiguous') {
      err(`"${commentArg}" matches multiple comments — use a longer id prefix:`);
      for (const cm of result.matches) {
        process.stderr.write(`  ${cm.id}  ${cm.authorName} (${cm.authorType})\n`);
      }
      process.exit(1);
    }
    const comment = result.item;
    const label = `${comment.authorName} (${comment.authorType})`;

    if (!opts.force) {
      if (!canPrompt()) {
        die(
          `Refusing to delete comment ${comment.id.slice(0, 8)} by ${label} without confirmation. Re-run with -f to force.`,
        );
      }
      const confirmed = await promptYesNo(
        `Delete comment ${comment.id.slice(0, 8)} by ${label}?`,
        false,
      );
      closePrompts();
      if (!confirmed) {
        info('Cancelled.');
        return;
      }
    }

    await apiDelete(`${base}/api/tickets/${uuid}/comments/${comment.id}`);
    ok(`Deleted comment ${c.dim(comment.id.slice(0, 8))} by ${label}`);
  },
};

export default def;

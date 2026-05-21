import type { CommandDef } from '../../../core/types.ts';
import { c, info } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { resolveTicketId } from '../_shared.ts';

interface CommentsOptions { board?: string }
interface Comment { authorType: string; authorName: string; createdAt: string; body: string }

const def: CommandDef = {
  name: 'comments',
  description: 'List comments on a ticket',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--board <id>', 'Disambiguate by board');
  },
  action: async (idArg: string, opts: CommentsOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    const comments = await apiGet<Comment[]>(`${base}/api/tickets/${uuid}/comments`);
    if (comments.length === 0) {
      info('No comments on this ticket.');
      return;
    }
    process.stdout.write('\n');
    for (const cm of comments) {
      const color = cm.authorType === 'agent' ? c.cyan : cm.authorType === 'user' ? c.green : (s: string) => s;
      process.stdout.write(`  ${color(c.bold(cm.authorName))} ${c.dim(`(${cm.authorType})`)}  ${c.dim(cm.createdAt)}\n`);
      for (const line of cm.body.split('\n')) {
        process.stdout.write(`    ${line}\n`);
      }
      process.stdout.write('\n');
    }
  },
};

export default def;

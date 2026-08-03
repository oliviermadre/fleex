import type { CommandDef } from '../../../core/types.ts';
import { c, info, present } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { resolveTicketId } from '../_shared.ts';

interface CommentsOptions { board?: string; json?: boolean }
interface Comment { id: string; authorType: string; authorName: string; createdAt: string; body: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'comments',
  description: 'List comments on a ticket (with their ids, for `comment-delete`)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
    cmd.option('--json', 'Output raw JSON');
  },
  action: async (idArg: string, opts: CommentsOptions) => {
    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    const comments = await apiGet<Comment[]>(`${base}/api/tickets/${uuid}/comments`);
    present(comments, () => {
      if (comments.length === 0) {
        info('No comments on this ticket.');
        return;
      }
      process.stdout.write('\n');
      for (const cm of comments) {
        const color = cm.authorType === 'agent' ? c.cyan : cm.authorType === 'user' ? c.green : (s: string) => s;
        // Show the bare 8-char id (no '#') so it matches `ticket mentions` and
        // can be pasted straight into `comment-delete`.
        const shortId = c.dim(cm.id.slice(0, 8));
        process.stdout.write(`  ${color(c.bold(cm.authorName))} ${c.dim(`(${cm.authorType})`)}  ${c.dim(cm.createdAt)}  ${shortId}\n`);
        for (const line of cm.body.split('\n')) {
          process.stdout.write(`    ${line}\n`);
        }
        process.stdout.write('\n');
      }
    });
  },
};

export default def;

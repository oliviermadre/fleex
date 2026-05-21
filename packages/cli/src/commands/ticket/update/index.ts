import type { CommandDef } from '../../../core/types.ts';
import { ok, die } from '../../../core/colors.ts';
import { apiBase, apiPatch } from '../../../core/api.ts';
import { assertValidStatus, assertValidPriority, resolveTicketId } from '../_shared.ts';

interface UpdateOptions {
  board?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  assignee?: string;
}

const def: CommandDef = {
  name: 'update',
  aliases: ['edit'],
  description: 'Update a ticket (PATCH, only provided fields are sent)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--board <id>', 'Disambiguate by board');
    cmd.option('--title <title>', 'New title');
    cmd.option('--description <description>', 'New description');
    cmd.option('--status <status>', 'New status');
    cmd.option('--priority <priority>', 'New priority');
    cmd.option('--assignee <name>', 'Assignee');
  },
  action: async (idArg: string, opts: UpdateOptions) => {
    const body: Record<string, unknown> = {};
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.status !== undefined) { assertValidStatus(opts.status); body.status = opts.status; }
    if (opts.priority !== undefined) { assertValidPriority(opts.priority); body.priority = opts.priority; }
    if (opts.assignee !== undefined) body.assignee = opts.assignee;
    if (Object.keys(body).length === 0) {
      die('No updates specified. Use --title, --description, --status, --priority, or --assignee.');
    }

    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();
    const result = await apiPatch<{ displayId: number; title: string }>(`${base}/api/tickets/${uuid}`, body);
    ok(`Updated ticket #${result.displayId}: ${result.title}`);
  },
};

export default def;

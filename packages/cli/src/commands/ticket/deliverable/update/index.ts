import { apiBase, apiPatch } from '../../../../core/api.ts';
import { ok, die } from '../../../../core/colors.ts';
import { resolveTicketId } from '../../_shared.ts';
import { assertValidStatus, resolveContent, type DeliverableDTO } from '../_shared.ts';

import type { CommandDef } from '../../../../core/types.ts';

interface UpdateOptions {
  board?: string;
  title?: string;
  status?: string;
  content?: string;
  file?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  aliases: ['edit'],
  description: 'Update a deliverable (partial PATCH — only provided fields change)',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.argument('<deliverable-id>', 'Deliverable UUID');
    cmd.option('--title <title>', 'New title');
    cmd.option('--status <status>', 'draft | final');
    cmd.option('--content <content>', 'New inline content (Markdown or HTML)');
    cmd.option('--file <path>', 'Read new content from file');
    cmd.option('--board <id>', 'Disambiguate by board');
  },
  action: async (ticketIdArg: string, delivId: string, opts: UpdateOptions) => {
    const body: Record<string, unknown> = {};
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.status !== undefined) {
      assertValidStatus(opts.status);
      body.status = opts.status;
    }
    const content = resolveContent({ content: opts.content, file: opts.file }, true);
    if (content !== undefined) body.content = content;

    if (Object.keys(body).length === 0) {
      die('Nothing to update: pass at least one of --title, --status, --content, --file.');
    }

    const uuid = await resolveTicketId(ticketIdArg, opts.board);
    const base = apiBase();
    const updated = await apiPatch<DeliverableDTO>(
      `${base}/api/tickets/${uuid}/deliverables/${delivId}`,
      body,
    );
    ok(`Deliverable updated: ${updated.id} (v${updated.version}, ${updated.status})`);
  },
};

export default def;

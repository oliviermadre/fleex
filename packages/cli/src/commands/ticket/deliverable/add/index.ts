import { apiBase, apiPost } from '../../../../core/api.ts';
import { ok, die } from '../../../../core/colors.ts';
import { resolveTicketId } from '../../_shared.ts';
import {
  assertValidType,
  assertValidStatus,
  resolveContent,
  type DeliverableDTO,
} from '../_shared.ts';

import type { CommandDef } from '../../../../core/types.ts';

interface AddOptions {
  board?: string;
  title?: string;
  type?: string;
  status?: string;
  content?: string;
  file?: string;
  agentName?: string;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'add',
  aliases: ['create', 'new'],
  description: 'Add a new deliverable to a ticket',
  setup(cmd) {
    cmd.argument('<ticket-id>', 'Ticket display ID or UUID');
    cmd.requiredOption('--title <title>', 'Deliverable title');
    cmd.option(
      '--type <type>',
      'Deliverable type (configured per workspace; run with an invalid value to list)',
      'report',
    );
    cmd.option('--status <status>', 'draft | final', 'draft');
    cmd.option('--content <content>', 'Inline content (Markdown or HTML)');
    cmd.option('--file <path>', 'Read content from file (Markdown or HTML)');
    cmd.option(
      '--agent-name <name>',
      'Override the agent name attached to this deliverable (default: cli)',
    );
    cmd.option('--board <id>', 'Disambiguate by board');
  },
  action: async (ticketIdArg: string, opts: AddOptions) => {
    if (!opts.title) die('Missing --title');
    const type = opts.type ?? 'report';
    const status = opts.status ?? 'draft';
    await assertValidType(type);
    assertValidStatus(status);
    const content = resolveContent({ content: opts.content, file: opts.file });

    const uuid = await resolveTicketId(ticketIdArg, opts.board);
    const base = apiBase();
    const created = await apiPost<DeliverableDTO>(`${base}/api/tickets/${uuid}/deliverables`, {
      title: opts.title,
      type,
      status,
      content,
      agentName: opts.agentName ?? 'cli',
    });
    ok(`Deliverable created: ${created.id}`);
  },
};

export default def;

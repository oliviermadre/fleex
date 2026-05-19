import type { CommandDef } from '../../../core/types.ts';
import { ok, die } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { assertValidStatus, assertValidPriority, resolveBoardId } from '../_shared.ts';

interface CreateOptions {
  board?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  tag?: string[];
}

const def: CommandDef = {
  name: 'create',
  aliases: ['new'],
  description: 'Create a new ticket (--title required)',
  setup(cmd) {
    cmd.requiredOption('--title <title>', 'Ticket title (required)');
    cmd.option('--board <id>', 'Board ID (auto-detected if only one)');
    cmd.option('--description <description>', 'Ticket description');
    cmd.option('--priority <priority>', 'Priority: none | low | medium | high');
    cmd.option('--status <status>', 'Initial status (default: backlog)');
    cmd.option('--tag <tag>', 'Tag (repeatable)', (val: string, prev: string[] = []) => [...prev, val], [] as string[]);
  },
  action: async (opts: CreateOptions) => {
    if (!opts.title) die('Missing required --title');
    if (opts.status) assertValidStatus(opts.status);
    if (opts.priority) assertValidPriority(opts.priority);

    const boardId = await resolveBoardId(opts.board);
    const body: Record<string, unknown> = { boardId, title: opts.title };
    if (opts.description) body.description = opts.description;
    if (opts.priority) body.priority = opts.priority;
    if (opts.status) body.status = opts.status;
    if (opts.tag && opts.tag.length > 0) body.tags = opts.tag;

    const base = apiBase();
    const result = await apiPost<{ displayId: number; title: string; status: string }>(`${base}/api/tickets`, body);
    ok(`Created ticket #${result.displayId}: ${result.title} (${result.status})`);
  },
};

export default def;

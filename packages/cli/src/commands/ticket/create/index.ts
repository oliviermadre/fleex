import type { CommandDef } from '../../../core/types.ts';
import { ok, die, present } from '../../../core/colors.ts';
import { apiBase, apiPost } from '../../../core/api.ts';
import { assertValidStatus, assertValidPriority, assertValidType, normalizeDueDate, resolveBoardId } from '../_shared.ts';

interface CreateOptions {
  board?: string;
  title?: string;
  description?: string;
  priority?: string;
  status?: string;
  type?: string;
  due?: string;
  tag?: string[];
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'create',
  aliases: ['new'],
  description: 'Create a new ticket (--title required)',
  setup(cmd) {
    cmd.requiredOption('--title <title>', 'Ticket title (required)');
    cmd.option('--board <id>', 'Board: name, UUID, or unique id prefix (auto-detected if only one)');
    cmd.option('--description <description>', 'Ticket description');
    cmd.option('--priority <priority>', 'Priority: none | low | medium | high');
    cmd.option('--status <status>', 'Initial status (default: backlog)');
    cmd.option('--type <type>', 'Type: build | fix | review | ops | lead | think');
    cmd.option('--due <date>', 'Due date (YYYY-MM-DD or ISO 8601)');
    cmd.option('--tag <tag>', 'Tag (repeatable)', (val: string, prev: string[] = []) => [...prev, val], [] as string[]);
  },
  action: async (opts: CreateOptions) => {
    if (!opts.title) die('Missing required --title');
    if (opts.status) assertValidStatus(opts.status);
    if (opts.priority) assertValidPriority(opts.priority);
    if (opts.type) assertValidType(opts.type);

    const boardId = await resolveBoardId(opts.board);
    const body: Record<string, unknown> = { boardId, title: opts.title };
    if (opts.description) body.description = opts.description;
    if (opts.priority) body.priority = opts.priority;
    if (opts.status) body.status = opts.status;
    if (opts.type) body.type = opts.type;
    if (opts.due) body.dueDate = normalizeDueDate(opts.due);
    if (opts.tag && opts.tag.length > 0) body.tags = opts.tag;

    const base = apiBase();
    const result = await apiPost<{ displayId: number; title: string; status: string }>(`${base}/api/tickets`, body);
    present(result, () => ok(`Created ticket #${result.displayId}: ${result.title} (${result.status})`));
  },
};

export default def;

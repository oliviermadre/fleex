import type { CommandDef } from '../../../core/types.ts';
import { ok, die, info, warn, present } from '../../../core/colors.ts';
import { apiBase, apiGet, apiPost, apiPatch, apiDelete } from '../../../core/api.ts';
import {
  assertValidStatus,
  assertValidPriority,
  assertValidType,
  normalizeDueDate,
  accumulate,
  resolveTicketId,
} from '../_shared.ts';
import { resolveEpicId } from '../../epic/_shared.ts';
import { resolveBoardId } from '../../board/_shared.ts';

interface UpdateOptions {
  board?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  type?: string;
  assignee?: string;
  favorite?: boolean;
  blocked?: boolean;
  due?: string;
  clearDue?: boolean;
  toBoard?: string;
  addTag?: string[];
  rmTag?: string[];
  addEpic?: string[];
  removeEpic?: string[];
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'update',
  aliases: ['edit'],
  description: 'Update a ticket (PATCH, only provided fields are sent)',
  setup(cmd) {
    cmd.argument('<id>', 'Ticket display ID or UUID');
    cmd.option('--board <board>', 'Disambiguate by board (name, UUID, or 8-char id prefix)');
    cmd.option('--title <title>', 'New title');
    cmd.option('--description <description>', 'New description');
    cmd.option('--status <status>', 'New status');
    cmd.option('--priority <priority>', 'New priority');
    cmd.option('--type <type>', 'Type: build | fix | review | ops | lead | think');
    cmd.option('--assignee <name>', 'Assignee');
    cmd.option('--favorite', 'Mark as favorite');
    cmd.option('--no-favorite', 'Unmark favorite');
    cmd.option('--blocked', 'Mark as blocked');
    cmd.option('--no-blocked', 'Unmark blocked');
    cmd.option('--due <date>', 'Set due date (YYYY-MM-DD or ISO 8601)');
    cmd.option('--clear-due', 'Clear the due date');
    cmd.option('--to-board <board>', 'Move the ticket to another board (name, UUID, or 8-char id prefix)');
    cmd.option('--add-tag <tag>', 'Add a tag (repeatable)', accumulate, [] as string[]);
    cmd.option('--rm-tag <tag>', 'Remove a tag (repeatable)', accumulate, [] as string[]);
    cmd.option('--add-epic <epic>', 'Add the ticket to an epic (id/prefix, repeatable)', accumulate, [] as string[]);
    cmd.option('--remove-epic <epic>', 'Remove the ticket from an epic (id/prefix, repeatable)', accumulate, [] as string[]);
  },
  action: async (idArg: string, opts: UpdateOptions) => {
    const addTags = opts.addTag ?? [];
    const rmTags = opts.rmTag ?? [];
    const addEpics = opts.addEpic ?? [];
    const removeEpics = opts.removeEpic ?? [];
    const hasTagOps = addTags.length > 0 || rmTags.length > 0;
    const hasEpicOps = addEpics.length > 0 || removeEpics.length > 0;

    if (opts.status !== undefined) assertValidStatus(opts.status);
    if (opts.priority !== undefined) assertValidPriority(opts.priority);
    if (opts.type !== undefined) assertValidType(opts.type);
    if (opts.due !== undefined && opts.clearDue) die('Use either --due or --clear-due, not both.');

    const body: Record<string, unknown> = {};
    if (opts.title !== undefined) body.title = opts.title;
    if (opts.description !== undefined) body.description = opts.description;
    if (opts.status !== undefined) body.status = opts.status;
    if (opts.priority !== undefined) body.priority = opts.priority;
    if (opts.type !== undefined) body.type = opts.type;
    if (opts.assignee !== undefined) body.assignee = opts.assignee;
    if (opts.favorite !== undefined) body.favorite = opts.favorite;
    if (opts.blocked !== undefined) body.blocked = opts.blocked;
    if (opts.due !== undefined) body.dueDate = normalizeDueDate(opts.due);
    if (opts.clearDue) body.dueDate = null;
    if (opts.toBoard !== undefined) body.boardId = await resolveBoardId(opts.toBoard);

    if (Object.keys(body).length === 0 && !hasTagOps && !hasEpicOps) {
      die('No updates specified. Use --title, --description, --status, --priority, --type, --assignee, --favorite/--no-favorite, --blocked/--no-blocked, --due/--clear-due, --to-board, --add-tag/--rm-tag, or --add-epic/--remove-epic.');
    }

    const uuid = await resolveTicketId(idArg, opts.board);
    const base = apiBase();

    // Incremental tag editing: read current tags, merge add/remove, send the result.
    if (hasTagOps) {
      const current = await apiGet<{ tags: string[] }>(`${base}/api/tickets/${uuid}`);
      const next = new Set(current.tags ?? []);
      for (const t of addTags) next.add(t);
      for (const t of rmTags) next.delete(t);
      body.tags = [...next];
    }

    let displayId: number | undefined;
    let title: string | undefined;
    // `null` = the server did not report a diff (older server); we then can't
    // claim a no-op, so we fall back to the previous, optimistic message.
    let changed: string[] | null = null;
    if (Object.keys(body).length > 0) {
      const result = await apiPatch<{ displayId: number; title: string; changed?: string[] }>(
        `${base}/api/tickets/${uuid}`,
        body,
      );
      displayId = result.displayId;
      title = result.title;
      changed = result.changed ?? null;
    }

    // Epic membership lives on a separate endpoint, not the ticket PATCH.
    for (const epic of addEpics) {
      const epicId = await resolveEpicId(epic);
      await apiPost(`${base}/api/epics/${epicId}/tickets/${uuid}`, undefined);
      info(`Added to epic ${epic}`);
    }
    for (const epic of removeEpics) {
      const epicId = await resolveEpicId(epic);
      await apiDelete(`${base}/api/epics/${epicId}/tickets/${uuid}`);
      info(`Removed from epic ${epic}`);
    }

    // A PATCH that changed nothing must not claim it did: an agent that trusts
    // "Updated" on a no-op reports work it never performed.
    if (changed !== null && changed.length === 0 && !hasTagOps && !hasEpicOps) {
      present(
        { ok: true, changed: [], ...(displayId !== undefined ? { ticketId: displayId } : {}) },
        () => warn(
          displayId !== undefined
            ? `No changes applied to ticket #${displayId} — values already match.`
            : 'No changes applied — values already match.',
        ),
      );
      return;
    }

    const suffix = changed && changed.length > 0 ? ` (${changed.join(', ')})` : '';
    present(
      { ok: true, changed: changed ?? [], ...(displayId !== undefined ? { ticketId: displayId } : {}) },
      () => ok(displayId !== undefined ? `Updated ticket #${displayId}: ${title}${suffix}` : 'Updated ticket'),
    );
  },
};

export default def;

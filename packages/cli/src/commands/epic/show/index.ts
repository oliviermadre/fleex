import type { CommandDef } from '../../../core/types.ts';
import { c, statusColor } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { resolveEpicId } from '../_shared.ts';

interface Epic {
  id: string;
  name: string;
  emoji?: string;
  description?: string | null;
  timeframe?: string | null;
  color?: string;
  groupStatus?: string;
  boardIds?: string[];
  blocked?: boolean;
  favorite?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface Board { id: string; name?: string }

interface Ticket {
  displayId: number;
  title: string;
  status: string;
  priority: string;
  type?: string | null;
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'show',
  aliases: ['view'],
  description: 'Show epic details and the list of its tickets',
  setup(cmd) {
    cmd.argument('<id>', 'Epic UUID or 8-char prefix');
  },
  action: async (idArg: string) => {
    const resolvedId = await resolveEpicId(idArg);
    const base = apiBase();
    const epic = await apiGet<Epic>(`${base}/api/epics/${resolvedId}`);

    // Resolve board names (boardIds → board names)
    let boardsDisplay = '-';
    if (epic.boardIds && epic.boardIds.length > 0) {
      const allBoards = await apiGet<Board[]>(`${base}/api/boards`);
      const byId = new Map(allBoards.map((b) => [b.id, b.name ?? 'Unknown']));
      boardsDisplay = epic.boardIds
        .map((bid) => `${bid.slice(0, 8)} (${byId.get(bid) ?? 'Unknown'})`)
        .join(', ');
    }

    const emojiPart = epic.emoji ? `${epic.emoji} ` : '';
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(`Epic ${emojiPart}${epic.name}`)}\n`);
    process.stdout.write('  ─────────────────────────────────────────────────────────\n');
    process.stdout.write(`  ${c.bold('Status:')}       ${epic.groupStatus ?? 'active'}\n`);
    process.stdout.write(`  ${c.bold('Timeframe:')}    ${epic.timeframe ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('Color:')}        ${epic.color ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('Boards:')}       ${boardsDisplay}\n`);
    process.stdout.write(`  ${c.bold('Blocked:')}      ${epic.blocked ?? false}\n`);
    process.stdout.write(`  ${c.bold('Favorite:')}     ${epic.favorite ?? false}\n`);
    process.stdout.write(`  ${c.bold('Created:')}      ${epic.createdAt ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('Updated:')}      ${epic.updatedAt ?? '-'}\n`);
    process.stdout.write(`  ${c.bold('UUID:')}         ${c.dim(epic.id)}\n`);

    if (epic.description) {
      process.stdout.write('\n');
      process.stdout.write(`  ${c.bold('Description:')}\n`);
      for (const line of epic.description.split('\n')) {
        process.stdout.write(`    ${line}\n`);
      }
    }

    const tickets = await apiGet<Ticket[]>(`${base}/api/epics/${resolvedId}/tickets`);
    process.stdout.write('\n');
    process.stdout.write(`  ${c.bold(`Tickets (${tickets.length}):`)}\n`);
    if (tickets.length === 0) {
      process.stdout.write(`    ${c.dim('No tickets')}\n`);
    } else {
      tickets.sort((a, b) => a.displayId - b.displayId);
      for (const t of tickets) {
        const colored = statusColor(t.status)(t.status.padEnd(11));
        const prio = (t.priority ?? '-').padEnd(8);
        const type = (t.type ?? '-').padEnd(8);
        process.stdout.write(`    #${String(t.displayId).padEnd(5)} ${colored} ${prio} ${type} ${t.title}\n`);
      }
    }
    process.stdout.write('\n');
  },
};

export default def;

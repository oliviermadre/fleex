import type { CommandDef } from '../../../core/types.ts';
import { c, info, statusColor, isJsonMode } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { resolveEpicId } from '../../epic/_shared.ts';
import { resolveBoardId } from '../../board/_shared.ts';

interface ListOptions {
  board?: string;
  status?: string;
  tag?: string;
  epic?: string;
}

interface Ticket {
  id: string;
  displayId: number;
  title: string;
  status: string;
  priority: string;
  assignee?: string | null;
  boardId: string;
}

interface Board { id: string; name: string }
interface Epic { id: string; name?: string; emoji?: string }
interface Membership { ticketId: string; groupId: string }

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List tickets (optionally filtered by --board, --status, --tag, --epic)',
  setup(cmd) {
    cmd.option('--board <board>', 'Filter by board (name, UUID, or 8-char id prefix)');
    cmd.option('--status <status>', 'Filter by status (backlog|todo|doing|reviewing|done|cancelled)');
    cmd.option('--tag <tag>', 'Filter by tag');
    cmd.option('--epic <id>', 'Filter by epic UUID or 8-char prefix');
  },
  action: async (opts: ListOptions) => {
    const base = apiBase();
    // Resolve once: the API only understands full board UUIDs, and this id is
    // reused by the epics/memberships queries below.
    const boardId = opts.board ? await resolveBoardId(opts.board) : undefined;
    const params: string[] = [];
    if (boardId) params.push(`boardId=${encodeURIComponent(boardId)}`);
    if (boardId && opts.status) params.push(`status=${encodeURIComponent(opts.status)}`);
    if (opts.tag) params.push(`tag=${encodeURIComponent(opts.tag)}`);
    // The server filters memberships by exact group id, so resolve any 8-char
    // prefix to a full UUID before querying.
    if (opts.epic) params.push(`epicId=${encodeURIComponent(await resolveEpicId(opts.epic))}`);
    const url = params.length ? `${base}/api/tickets?${params.join('&')}` : `${base}/api/tickets`;

    let tickets = await apiGet<Ticket[]>(url);
    // Server only filters status when boardId is set; mirror the bash fallback.
    if (opts.status && !boardId) {
      tickets = tickets.filter((t) => t.status === opts.status);
    }

    if (isJsonMode()) { process.stdout.write(JSON.stringify(tickets) + '\n'); return; }

    if (tickets.length === 0) { info('No tickets found.'); return; }

    // Fetch epics + memberships once to label tickets with their first epic.
    const epicsUrl = boardId ? `${base}/api/epics?boardId=${encodeURIComponent(boardId)}` : `${base}/api/epics`;
    const membershipsUrl = boardId ? `${base}/api/epics/memberships?boardId=${encodeURIComponent(boardId)}` : `${base}/api/epics/memberships`;
    const [epics, memberships] = await Promise.all([
      apiGet<Epic[]>(epicsUrl),
      apiGet<Membership[]>(membershipsUrl),
    ]);
    const epicById = new Map(epics.map((e) => [e.id, `${e.emoji ? e.emoji + ' ' : ''}${e.name ?? ''}`.trim()]));
    const epicsByTicket = new Map<string, string[]>();
    for (const m of memberships) {
      const arr = epicsByTicket.get(m.ticketId) ?? [];
      arr.push(m.groupId);
      epicsByTicket.set(m.ticketId, arr);
    }
    const epicLabel = (tid: string): string => {
      const gids = epicsByTicket.get(tid) ?? [];
      for (const g of gids) {
        const l = epicById.get(g);
        if (l) return l;
      }
      return '-';
    };

    const showBoard = !boardId;
    let boardMap: Map<string, string> = new Map();
    if (showBoard) {
      const boards = await apiGet<Board[]>(`${base}/api/boards`);
      boardMap = new Map(boards.map((b) => [b.id, b.name]));
      tickets.sort((a, b) => {
        const ba = boardMap.get(a.boardId) ?? 'Unknown';
        const bb = boardMap.get(b.boardId) ?? 'Unknown';
        if (ba !== bb) return ba.localeCompare(bb);
        return a.displayId - b.displayId;
      });
    } else {
      tickets.sort((a, b) => a.displayId - b.displayId);
    }

    process.stdout.write('\n');
    if (showBoard) {
      process.stdout.write(`  ${c.bold('#     '.padEnd(7) + 'Board                  ' + 'Status      ' + 'Prio     ' + 'Assignee     ' + 'Epic               ' + 'Title')}\n`);
      process.stdout.write(`  ${'──────'.padEnd(7)}${'──────────────────────'.padEnd(23)}${'───────────'.padEnd(12)}${'────────'.padEnd(9)}${'────────────'.padEnd(13)}${'──────────────────'.padEnd(19)}──────────────────────────────\n`);
    } else {
      process.stdout.write(`  ${c.bold('#     '.padEnd(7) + 'Status      ' + 'Prio     ' + 'Assignee     ' + 'Epic               ' + 'Title')}\n`);
      process.stdout.write(`  ${'──────'.padEnd(7)}${'───────────'.padEnd(12)}${'────────'.padEnd(9)}${'────────────'.padEnd(13)}${'──────────────────'.padEnd(19)}──────────────────────────────\n`);
    }

    for (const t of tickets) {
      const did = `#${t.displayId}`;
      const status = t.status.padEnd(11);
      const colored = statusColor(t.status)(status);
      const prio = (t.priority ?? '-').padEnd(8);
      const assignee = (t.assignee ?? '-').padEnd(12);
      const ep = epicLabel(t.id).slice(0, 18).padEnd(18);
      if (showBoard) {
        const board = (boardMap.get(t.boardId) ?? 'Unknown').slice(0, 22).padEnd(22);
        process.stdout.write(`  ${did.padEnd(6)} ${board} ${colored} ${prio} ${assignee} ${ep} ${t.title}\n`);
      } else {
        process.stdout.write(`  ${did.padEnd(6)} ${colored} ${prio} ${assignee} ${ep} ${t.title}\n`);
      }
    }
    process.stdout.write('\n');
    info(`${tickets.length} ticket(s)`);
  },
};

export default def;

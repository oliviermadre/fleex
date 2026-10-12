import chalk from 'chalk';
import { TICKET_STATUSES } from '@fleex/shared';
import type { CommandDef } from '../../../core/types.ts';
import { c, info, die, statusColor, isJsonMode } from '../../../core/colors.ts';
import { apiBase, apiGet } from '../../../core/api.ts';
import { resolveEpicId } from '../../epic/_shared.ts';
import { resolveBoardId } from '../../board/_shared.ts';

interface ListOptions {
  board?: string;
  status?: string;
  tag?: string;
  epic?: string;
  all?: boolean;
  limit?: string;
  jsonFull?: boolean;
}

export interface Ticket {
  id: string;
  displayId: number;
  title: string;
  status: string;
  priority?: string | null;
  type?: string | null;
  tags?: string[];
  assignee?: string | null;
  boardId: string;
  updatedAt?: string;
}

interface Board { id: string; name: string }
interface Epic { id: string; name?: string; emoji?: string }
interface Membership { ticketId: string; groupId: string }

/** Rows returned when the caller does not pass `--limit`. */
export const DEFAULT_LIMIT = 50;

/**
 * Statuses dropped unless the caller asks for them. They are ~60% of a mature
 * board and almost never what an agent wants — listing them by default is how
 * one `ticket list --json` call blew past the model context window.
 */
const TERMINAL_STATUSES = ['done', 'cancelled'] as const;

export interface HiddenCounts { done: number; cancelled: number }

export interface Selection<T> {
  tickets: T[];
  /** Eligible tickets after the status filter, before the limit. */
  total: number;
  truncated: boolean;
  /** Set only when the default done/cancelled exclusion applied. */
  hidden: HiddenCounts | null;
}

/** Parse `--status a,b`. Unknown values abort: a typo must not silently return nothing. */
export function parseStatuses(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const list = raw.split(',').map((s) => s.trim()).filter(Boolean);
  const valid = TICKET_STATUSES as readonly string[];
  for (const s of list) {
    if (!valid.includes(s)) die(`Unknown status '${s}'. Expected: ${valid.join('|')}`);
  }
  return list.length ? list : undefined;
}

export function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_LIMIT;
  const trimmed = String(raw).trim();
  if (!/^\d+$/.test(trimmed)) die('--limit must be an integer >= 0');
  return Number(trimmed);
}

/**
 * Status filter then limit. The limit keeps the most recently updated tickets:
 * truncating in display-id order would hand back the oldest ones, the least
 * useful. Returned order is the input order (the caller sorts for display).
 */
export function selectTickets<T extends Ticket>(
  input: T[],
  opts: { statuses?: string[]; all?: boolean; limit: number },
): Selection<T> {
  let hidden: HiddenCounts | null = null;
  let eligible: T[];
  if (opts.statuses) {
    const wanted = new Set(opts.statuses);
    eligible = input.filter((t) => wanted.has(t.status));
  } else if (opts.all) {
    eligible = input;
  } else {
    hidden = { done: 0, cancelled: 0 };
    eligible = [];
    for (const t of input) {
      if ((TERMINAL_STATUSES as readonly string[]).includes(t.status)) hidden[t.status as keyof HiddenCounts]++;
      else eligible.push(t);
    }
  }

  const total = eligible.length;
  if (opts.limit === 0 || total <= opts.limit) {
    return { tickets: eligible, total, truncated: false, hidden };
  }
  const kept = new Set(
    [...eligible]
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || b.displayId - a.displayId)
      .slice(0, opts.limit),
  );
  return { tickets: eligible.filter((t) => kept.has(t)), total, truncated: true, hidden };
}

function hiddenPhrase(hidden: HiddenCounts | null): string | null {
  if (!hidden) return null;
  const parts: string[] = [];
  if (hidden.done) parts.push(`${hidden.done} done`);
  if (hidden.cancelled) parts.push(`${hidden.cancelled} cancelled`);
  return parts.length ? `${parts.join(' / ')} hidden` : null;
}

/** One-line, colourless summary of what was filtered or capped; null when nothing was. */
export function buildNotice(sel: Selection<unknown>): string | null {
  const parts: string[] = [];
  if (sel.truncated) parts.push(`${sel.tickets.length} of ${sel.total} shown (use --limit 0 for all).`);
  const h = hiddenPhrase(sel.hidden);
  if (h) parts.push(`${h} (use --status or --all).`);
  return parts.length ? parts.join(' ') : null;
}

export interface SlimTicket {
  id: string;
  displayId: number;
  board: string;
  status: string;
  priority: string | null;
  type: string | null;
  assignee: string | null;
  epic: string | null;
  tags: string[];
  updatedAt: string | null;
  title: string;
}

/** The grid row as JSON. Never carries `description`, links or metadata. */
export function toSlim(t: Ticket, ctx: { boardName: (id: string) => string; epicLabel: (id: string) => string | null }): SlimTicket {
  return {
    id: t.id,
    displayId: t.displayId,
    board: ctx.boardName(t.boardId),
    status: t.status,
    priority: t.priority ?? null,
    type: t.type ?? null,
    assignee: t.assignee ?? null,
    epic: ctx.epicLabel(t.id),
    tags: t.tags ?? [],
    updatedAt: t.updatedAt ?? null,
    title: t.title,
  };
}

const def: CommandDef = {
  workspaceAware: true,
  name: 'list',
  aliases: ['ls'],
  description: 'List tickets: done/cancelled hidden unless --status/--all, capped by --limit (default 50). --json is slim (no description); --json-full is expensive.',
  extraHelp: `
${chalk.bold.yellow('Token budget:')}
  --json is slim: the grid columns + id, type, tags, updatedAt. Never the description.
  --json-full loads every field and can blow the context window: use it deliberately, with --limit.
  done/cancelled are hidden by default: use --status done or --all to see them.
  At most ${DEFAULT_LIMIT} tickets by default (--limit 0 = all, most recently updated kept first).
  Prefer --board + --status + --limit. Full ticket: fleex ticket show <id>.
  To find a ticket: fleex memory search "<query>" / fleex memory similar "<title>".
`,
  setup(cmd) {
    cmd.option('--board <board>', 'Filter by board (name, UUID, or 8-char id prefix)');
    cmd.option('--status <status>', 'Filter by status, comma-separated (backlog|todo|doing|reviewing|done|cancelled). Always wins over the default done/cancelled hiding');
    cmd.option('--tag <tag>', 'Filter by tag');
    cmd.option('--epic <id>', 'Filter by epic UUID or 8-char prefix');
    cmd.option('--all', 'Include done/cancelled tickets (ignored when --status is set)');
    cmd.option('--limit <n>', `Max tickets returned, most recently updated first (0 = no limit). Default: ${DEFAULT_LIMIT}`);
    cmd.option('--json-full', 'Output every ticket field (description, links, metadata…) as JSON. WARNING: can load a very large number of tokens. Prefer --json, or \'ticket show\' for a single ticket.');
  },
  action: async (opts: ListOptions) => {
    // Validate before any network call so a bad flag fails fast.
    const statuses = parseStatuses(opts.status);
    const limit = parseLimit(opts.limit);

    const base = apiBase();
    // Resolve once: the API only understands full board UUIDs, and this id is
    // reused by the epics/memberships queries below.
    const boardId = opts.board ? await resolveBoardId(opts.board) : undefined;
    const params: string[] = [];
    if (boardId) params.push(`boardId=${encodeURIComponent(boardId)}`);
    // The server filters a single status, and only when boardId is set.
    if (boardId && statuses?.length === 1) params.push(`status=${encodeURIComponent(statuses[0]!)}`);
    if (opts.tag) params.push(`tag=${encodeURIComponent(opts.tag)}`);
    // The server filters memberships by exact group id, so resolve any 8-char
    // prefix to a full UUID before querying.
    if (opts.epic) params.push(`epicId=${encodeURIComponent(await resolveEpicId(opts.epic))}`);
    const url = params.length ? `${base}/api/tickets?${params.join('&')}` : `${base}/api/tickets`;

    const all = await apiGet<Ticket[]>(url);
    const sel = selectTickets(all, { statuses, all: opts.all, limit });
    const notice = buildNotice(sel);

    // Full DTOs, server order, bare array: strict compatibility with the old
    // `--json`. The notice goes to stderr so stdout stays one JSON value.
    if (opts.jsonFull) {
      process.stdout.write(JSON.stringify(sel.tickets) + '\n');
      if (notice) process.stderr.write(`[fleex] ${notice}\n`);
      return;
    }

    const tickets = sel.tickets;
    const json = isJsonMode();
    if (tickets.length === 0) {
      if (json) {
        process.stdout.write(JSON.stringify({ tickets: [], total: sel.total, returned: 0, truncated: false, hidden: sel.hidden, notice }) + '\n');
        return;
      }
      info('No tickets found.');
      const h = hiddenPhrase(sel.hidden);
      if (h) info(`(${h} — use --status or --all)`);
      return;
    }

    // Fetch epics + memberships (+ boards) once to label tickets.
    const epicsUrl = boardId ? `${base}/api/epics?boardId=${encodeURIComponent(boardId)}` : `${base}/api/epics`;
    const membershipsUrl = boardId ? `${base}/api/epics/memberships?boardId=${encodeURIComponent(boardId)}` : `${base}/api/epics/memberships`;
    const showBoard = !boardId;
    // JSON always carries the board name; the grid only needs it without --board.
    const needBoards = showBoard || json;
    const [epics, memberships, boards] = await Promise.all([
      apiGet<Epic[]>(epicsUrl),
      apiGet<Membership[]>(membershipsUrl),
      needBoards ? apiGet<Board[]>(`${base}/api/boards`) : Promise.resolve([] as Board[]),
    ]);
    const epicById = new Map(epics.map((e) => [e.id, `${e.emoji ? e.emoji + ' ' : ''}${e.name ?? ''}`.trim()]));
    const epicsByTicket = new Map<string, string[]>();
    for (const m of memberships) {
      const arr = epicsByTicket.get(m.ticketId) ?? [];
      arr.push(m.groupId);
      epicsByTicket.set(m.ticketId, arr);
    }
    const epicLabel = (tid: string): string | null => {
      const gids = epicsByTicket.get(tid) ?? [];
      for (const g of gids) {
        const l = epicById.get(g);
        if (l) return l;
      }
      return null;
    };
    const boardMap = new Map(boards.map((b) => [b.id, b.name]));
    const boardName = (id: string): string => boardMap.get(id) ?? 'Unknown';

    if (showBoard) {
      tickets.sort((a, b) => {
        const ba = boardName(a.boardId);
        const bb = boardName(b.boardId);
        if (ba !== bb) return ba.localeCompare(bb);
        return a.displayId - b.displayId;
      });
    } else {
      tickets.sort((a, b) => a.displayId - b.displayId);
    }

    if (json) {
      process.stdout.write(JSON.stringify({
        tickets: tickets.map((t) => toSlim(t, { boardName, epicLabel })),
        total: sel.total,
        returned: tickets.length,
        truncated: sel.truncated,
        hidden: sel.hidden,
        notice,
      }) + '\n');
      return;
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
      const ep = (epicLabel(t.id) ?? '-').slice(0, 18).padEnd(18);
      if (showBoard) {
        const board = boardName(t.boardId).slice(0, 22).padEnd(22);
        process.stdout.write(`  ${did.padEnd(6)} ${board} ${colored} ${prio} ${assignee} ${ep} ${t.title}\n`);
      } else {
        process.stdout.write(`  ${did.padEnd(6)} ${colored} ${prio} ${assignee} ${ep} ${t.title}\n`);
      }
    }
    process.stdout.write('\n');
    info(`${tickets.length} ticket(s)${sel.truncated ? ` (of ${sel.total} — use --limit 0 for all)` : ''}`);
    const h = hiddenPhrase(sel.hidden);
    if (h) info(`(${h} — use --status or --all)`);
  },
};

export default def;

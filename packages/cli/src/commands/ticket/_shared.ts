import { die, err, c } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';

export const VALID_STATUSES = ['backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled'] as const;
export const VALID_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;

export function assertValidStatus(s: string): void {
  if (!VALID_STATUSES.includes(s as typeof VALID_STATUSES[number])) {
    die(`Invalid status: ${s} (valid: ${VALID_STATUSES.join(', ')})`);
  }
}

export function assertValidPriority(p: string): void {
  if (!VALID_PRIORITIES.includes(p as typeof VALID_PRIORITIES[number])) {
    die(`Invalid priority: ${p} (valid: ${VALID_PRIORITIES.join(', ')})`);
  }
}

interface Board { id: string; name: string; emoji?: string }
interface Ticket {
  id: string;
  displayId: number;
  title: string;
  boardId: string;
}

/**
 * Resolve a user-provided ticket id (display id like `42` or `#42`, or a full
 * UUID) to a UUID via the API. If multiple boards have a ticket with the same
 * displayId, prints a disambiguation message and exits.
 */
export async function resolveTicketId(input: string, boardId?: string): Promise<string> {
  const cleaned = input.startsWith('#') ? input.slice(1) : input;

  // Already a UUID?
  if (cleaned.includes('-') && cleaned.length >= 36) {
    return cleaned;
  }

  if (!/^\d+$/.test(cleaned)) {
    die(`Invalid ticket ID: ${input} (use a display ID number or UUID)`);
  }
  const did = parseInt(cleaned, 10);

  const base = apiBase();
  const url = boardId ? `${base}/api/tickets?boardId=${encodeURIComponent(boardId)}` : `${base}/api/tickets`;
  const tickets = await apiGet<Ticket[]>(url);
  const matches = tickets.filter((t) => t.displayId === did);

  if (matches.length === 0) die(`No ticket found with display ID #${cleaned}`);
  if (matches.length === 1) return matches[0]!.id;

  // Multiple matches — fetch boards to print a helpful disambiguation
  const boards = await apiGet<Board[]>(`${base}/api/boards`);
  err(`There are ${matches.length} tickets with the id ${cleaned}, consider using the --board flag`);
  process.stderr.write(`${c.blue('[fleex]')} Tickets found:\n`);
  for (const t of matches) {
    const b = boards.find((x) => x.id === t.boardId);
    process.stderr.write(`  - ${t.title} - Board ${b?.name ?? 'Unknown'} (uuid = ${t.boardId})\n`);
  }
  process.exit(1);
}

/**
 * Resolve a board ID. If `specified` is provided, return it. Otherwise:
 *   - If exactly one board exists, auto-select it.
 *   - Otherwise print the list and exit.
 */
export async function resolveBoardId(specified?: string): Promise<string> {
  if (specified) return specified;
  const base = apiBase();
  const boards = await apiGet<Board[]>(`${base}/api/boards`);
  if (boards.length === 0) die('No boards found. Create one in the web UI first.');
  if (boards.length === 1) return boards[0]!.id;
  err('Multiple boards found. Specify one with --board ID:');
  for (const b of boards) {
    process.stderr.write(`  ${b.id}  ${b.emoji ?? ''} ${b.name}\n`);
  }
  process.exit(1);
}

/** Resolve an epic id from an 8-char prefix or full UUID. */
export async function resolveEpicId(input: string): Promise<string> {
  if (input.length >= 36) return input;
  const base = apiBase();
  const epics = await apiGet<{ id: string }[]>(`${base}/api/epics`);
  const match = epics.find((e) => e.id.startsWith(input));
  if (!match) die(`Epic not found: ${input}`);
  return match.id;
}

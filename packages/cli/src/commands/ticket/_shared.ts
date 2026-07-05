import { die, err, c } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';

export const VALID_STATUSES = ['backlog', 'todo', 'doing', 'reviewing', 'done', 'cancelled'] as const;
export const VALID_PRIORITIES = ['none', 'low', 'medium', 'high'] as const;
export const VALID_TYPES = ['build', 'fix', 'review', 'ops', 'lead', 'think'] as const;

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

export function assertValidType(t: string): void {
  if (!VALID_TYPES.includes(t as typeof VALID_TYPES[number])) {
    die(`Invalid type: ${t} (valid: ${VALID_TYPES.join(', ')})`);
  }
}

/** Repeatable-option accumulator for Commander (e.g. --add-tag a --add-tag b). */
export function accumulate(val: string, prev: string[] = []): string[] {
  return [...prev, val];
}

/**
 * Parse and validate a GitHub PR/issue reference in the form `org/name#123`.
 * Exits with a helpful message on malformed input. Returns the canonical ref
 * plus its parts and a GitHub URL (`/pull/` or `/issues/` per `kind`).
 */
export function parseGithubRef(
  input: string,
  kind: 'pull' | 'issues',
): { ref: string; org: string; name: string; number: number; url: string } {
  const m = input.match(/^([^/]+)\/([^#/]+)#(\d+)$/);
  if (!m) {
    die(`Invalid reference "${input}" (expected format org/name#number, e.g. odys-travel/odys-api#123)`);
  }
  const [, org, name, num] = m as RegExpMatchArray;
  return {
    ref: input,
    org: org!,
    name: name!,
    number: parseInt(num!, 10),
    url: `https://github.com/${org}/${name}/${kind}/${num}`,
  };
}

/**
 * Parse a full GitHub issue URL (`https://github.com/{org}/{name}/issues/{n}`)
 * into its parts. Tolerates `http`, a trailing slash, and a query/fragment.
 * Exits with a helpful message on anything that isn't a GitHub *issue* URL
 * (e.g. a `/pull/` URL or a non-github host). Returns the canonical
 * `org/name#number` ref and a normalized issue URL, mirroring `parseGithubRef`.
 */
export function parseGithubIssueUrl(
  input: string,
): { ref: string; org: string; name: string; number: number; url: string } {
  const m = input.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:[/?#].*)?$/,
  );
  if (!m) {
    die(`Invalid GitHub issue URL "${input}" (expected https://github.com/org/name/issues/N)`);
  }
  const [, org, name, num] = m as RegExpMatchArray;
  const number = parseInt(num!, 10);
  return {
    ref: `${org}/${name}#${number}`,
    org: org!,
    name: name!,
    number,
    url: `https://github.com/${org}/${name}/issues/${number}`,
  };
}

/**
 * Normalize a due date input (`YYYY-MM-DD` or a full ISO string) to an ISO
 * 8601 string. Exits if the value can't be parsed into a real date.
 */
export function normalizeDueDate(input: string): string {
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(input);
  const ms = Date.parse(isDateOnly ? `${input}T00:00:00.000Z` : input);
  if (Number.isNaN(ms)) {
    die(`Invalid due date: ${input} (expected YYYY-MM-DD or an ISO 8601 timestamp)`);
  }
  return new Date(ms).toISOString();
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
 * Resolve any ticket — active OR archived — to its UUID.
 *
 * `resolveTicketId` only queries the active-ticket list, so it can't find an
 * archived ticket (needed by `ticket unarchive`). `GET /api/tickets/:id`
 * accepts a UUID or displayId and spans archived tickets, and the archive /
 * unarchive routes require a UUID — so we resolve through it here.
 */
export async function resolveAnyTicketUuid(input: string): Promise<string> {
  const cleaned = input.startsWith('#') ? input.slice(1) : input;
  if (cleaned.includes('-') && cleaned.length >= 36) return cleaned;
  if (!/^\d+$/.test(cleaned)) {
    die(`Invalid ticket ID: ${input} (use a display ID number or UUID)`);
  }
  const base = apiBase();
  const ticket = await apiGet<{ id: string }>(`${base}/api/tickets/${encodeURIComponent(cleaned)}`);
  return ticket.id;
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

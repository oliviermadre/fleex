import { die, err, info, c, isJsonMode } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import { matchById, type MatchResult } from '../../core/match.ts';

export interface Board {
  id: string;
  name: string;
  emoji?: string;
}

type StatusKey = 'backlog' | 'todo' | 'doing' | 'reviewing' | 'done' | 'cancelled';

export interface BoardWithCounts extends Board {
  ticketCounts?: Partial<Record<StatusKey, number>>;
}

/**
 * Fetch all boards and print them with per-status ticket counts (or the raw
 * JSON array in --json mode). Shared by `board list` and `ticket boards` so the
 * two surfaces render identically and can never drift.
 */
export async function listBoardsWithCounts(): Promise<void> {
  const boards = await apiGet<BoardWithCounts[]>(`${apiBase()}/api/boards`);
  if (isJsonMode()) {
    process.stdout.write(JSON.stringify(boards) + '\n');
    return;
  }
  if (boards.length === 0) {
    info('No boards found.');
    return;
  }
  process.stdout.write('\n');
  process.stdout.write(`  ${c.bold('Board                       Backlog   Todo  Doing Review   Done  Canc.  ID')}\n`);
  process.stdout.write('  ──────────────────────────  ───────  ─────  ───── ──────  ─────  ─────  ────────────────────────────────────\n');
  for (const b of boards) {
    const label = `${b.emoji ?? ''} ${b.name}`.trim().slice(0, 26).padEnd(26);
    const cnt = b.ticketCounts ?? {};
    const n = (k: StatusKey) => String(cnt[k] ?? 0).padStart(6);
    process.stdout.write(`  ${label} ${n('backlog')}  ${n('todo')}  ${n('doing')} ${n('reviewing')}  ${n('done')}  ${n('cancelled')}  ${c.dim(b.id)}\n`);
  }
  process.stdout.write('\n');
}

/**
 * Resolve a board reference against a fetched list. Matches, in order:
 *   1. an exact UUID or unique id prefix (via {@link matchById}), then
 *   2. a case-insensitive exact name.
 *
 * Pure so it can be unit-tested without a running server.
 */
export function pickBoard(boards: readonly Board[], input: string): MatchResult<Board> {
  const byId = matchById(boards, input);
  if (byId.kind !== 'none') return byId;

  const lower = input.trim().toLowerCase();
  if (!lower) return { kind: 'none' };
  const byName = boards.filter((b) => b.name.toLowerCase() === lower);
  if (byName.length === 1) return { kind: 'found', item: byName[0]! };
  if (byName.length > 1) return { kind: 'ambiguous', matches: byName };
  return { kind: 'none' };
}

/** True if `s` has the shape of a full board UUID. */
const isUuid = (s: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.trim());

/**
 * Process-local cache of `GET /api/boards`. A single command may resolve two
 * board references (e.g. `ticket update --board X --to-board Y`); without this
 * it would fetch the same list twice.
 */
let boardsCache: Board[] | null = null;

/** Drop the memoized board list (tests, or long-lived processes). */
export function resetBoardCache(): void {
  boardsCache = null;
}

/** The board list, fetched at most once per CLI invocation. */
export async function fetchBoards(): Promise<Board[]> {
  if (boardsCache) return boardsCache;
  boardsCache = await apiGet<Board[]>(`${apiBase()}/api/boards`);
  return boardsCache;
}

/**
 * Fetch boards and resolve `input` to a single board, exiting with a helpful
 * message when nothing matches or the reference is ambiguous.
 */
export async function resolveBoard(input: string): Promise<Board> {
  const boards = await fetchBoards();
  const result = pickBoard(boards, input);
  if (result.kind === 'found') return result.item;
  if (result.kind === 'ambiguous') {
    err(`"${input}" matches multiple boards — be more specific:`);
    for (const b of result.matches) {
      process.stderr.write(`  ${b.id}  ${b.emoji ?? ''} ${b.name}\n`);
    }
    process.exit(1);
  }
  // Distinguish "this board really doesn't exist" from "this isn't a shape we
  // could resolve" — the second is the one that used to send agents into retry
  // loops after copying an 8-char id out of `board list`.
  if (isUuid(input)) die(`Board not found: ${input.trim()}`);
  die(
    `No board matches "${input}" (tried full UUID, id prefix, and exact name). ` +
      `List boards with ${c.cyan('fleex board list')}.`,
  );
}

/** Convenience wrapper returning just the resolved board UUID. */
export async function resolveBoardId(input: string): Promise<string> {
  return (await resolveBoard(input)).id;
}

/**
 * Resolve a board reference, falling back to auto-detection when none is given:
 *   - no board (or an empty string, e.g. an unset shell variable) → the single
 *     existing board, or the list + exit when there is more than one;
 *   - otherwise → the usual name / UUID / id-prefix resolution.
 */
export async function resolveBoardIdOrDefault(specified?: string): Promise<string> {
  if (specified && specified.trim()) return resolveBoardId(specified);

  const boards = await fetchBoards();
  if (boards.length === 0) die('No boards found. Create one in the web UI first.');
  if (boards.length === 1) return boards[0]!.id;
  err('Multiple boards found. Specify one with --board (name, UUID, or 8-char id prefix):');
  for (const b of boards) {
    // 8-char ids, matching what `board list` and `ticket boards` display.
    process.stderr.write(`  ${b.id.slice(0, 8)}  ${b.emoji ?? ''} ${b.name}\n`);
  }
  process.exit(1);
}

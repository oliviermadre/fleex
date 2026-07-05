import { die, err, c } from '../../core/colors.ts';
import { apiBase, apiGet } from '../../core/api.ts';
import { matchById, type MatchResult } from '../../core/match.ts';

export interface Board {
  id: string;
  name: string;
  emoji?: string;
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

/**
 * Fetch boards and resolve `input` to a single board, exiting with a helpful
 * message when nothing matches or the reference is ambiguous.
 */
export async function resolveBoard(input: string): Promise<Board> {
  const boards = await apiGet<Board[]>(`${apiBase()}/api/boards`);
  const result = pickBoard(boards, input);
  if (result.kind === 'found') return result.item;
  if (result.kind === 'ambiguous') {
    err(`"${input}" matches multiple boards — be more specific:`);
    for (const b of result.matches) {
      process.stderr.write(`  ${b.id}  ${b.emoji ?? ''} ${b.name}\n`);
    }
    process.exit(1);
  }
  die(`No board matches "${input}". List boards with ${c.cyan('fleex ticket boards')}.`);
}

/**
 * Resolve a user-supplied identifier against a list of `{ id }` records.
 *
 * List/table commands (e.g. `ticket mentions`, `ticket comments`, board lists)
 * surface only the first 8 chars of a UUID to keep output readable. Write
 * commands therefore accept either the full UUID or that short prefix. This
 * helper centralises that resolution so every command behaves identically and
 * reports ambiguity instead of silently acting on the wrong record.
 */

/** Outcome of resolving an id/prefix against a list. */
export type MatchResult<T> =
  | { kind: 'found'; item: T }
  | { kind: 'none' }
  | { kind: 'ambiguous'; matches: T[] };

/**
 * Match `input` against `items` by:
 *   1. an exact `id` (full UUID), then
 *   2. a unique `id` prefix (e.g. the 8-char id shown in list tables).
 *
 * Returns `ambiguous` when a prefix matches more than one id so the caller can
 * refuse to act rather than guess. An empty `input` never matches.
 */
export function matchById<T extends { id: string }>(items: readonly T[], input: string): MatchResult<T> {
  const needle = input.trim();
  if (!needle) return { kind: 'none' };

  const exact = items.find((x) => x.id === needle);
  if (exact) return { kind: 'found', item: exact };

  const prefixed = items.filter((x) => x.id.startsWith(needle));
  if (prefixed.length === 1) return { kind: 'found', item: prefixed[0]! };
  if (prefixed.length > 1) return { kind: 'ambiguous', matches: prefixed };
  return { kind: 'none' };
}

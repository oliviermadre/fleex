import type { Board, UpdateBoardRequest } from '@fleex/shared';

/** Emoji the server gives a board created without one (`BoardEntity.create`). */
export const DEFAULT_BOARD_EMOJI = '📋';

/**
 * Keep the first grapheme of what the user typed, or `null` when the field is
 * blank. A grapheme, not a code point: `👩‍💻` (ZWJ) or `🇫🇷` must survive whole.
 * Any character is accepted — we don't try to decide what counts as an emoji.
 */
export function normalizeEmoji(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(trimmed);
  for (const { segment } of segments) return segment;
  return null;
}

/**
 * The PATCH body for a board edit: only the fields that actually changed, or
 * `null` when nothing did (so no request is sent). A blank name or a blank
 * emoji keeps the current value — a board can't lose either.
 */
export function boardChanges(
  board: Pick<Board, 'name' | 'emoji'>,
  draft: { name: string; emoji: string },
): UpdateBoardRequest | null {
  const name = draft.name.trim();
  const emoji = normalizeEmoji(draft.emoji);
  const changes: UpdateBoardRequest = {
    ...(name && name !== board.name ? { name } : {}),
    ...(emoji && emoji !== board.emoji ? { emoji } : {}),
  };
  return Object.keys(changes).length > 0 ? changes : null;
}

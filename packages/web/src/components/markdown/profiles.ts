import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';

/**
 * Two rendering profiles, mirroring what GitHub does: strict CommonMark for
 * `.md` files in a repo, hard breaks for issue/PR comments typed in a textarea.
 *
 * The stored text is never rewritten — only the renderer option changes.
 */
export type MarkdownProfile = 'user' | 'doc';

/**
 * Content typed in a textarea or produced in conversational mode.
 * A lone `\n` becomes a <br>, so what the user typed is what they see back.
 * This is the default across Fleex: every markdown surface today is either
 * user input or LLM chat output, never hand-wrapped authored markdown.
 */
export const userRemarkPlugins = [remarkGfm, remarkBreaks];

/**
 * Authored markdown (imported files, docs) where lines are hand-wrapped at
 * ~80 columns: we keep the CommonMark soft break (rendered as a space),
 * otherwise the output turns into a staircase.
 */
export const docRemarkPlugins = [remarkGfm];

/**
 * Plugin arrays are module-level constants so their reference stays stable
 * across renders — `MarkdownRenderer` is `memo()`-wrapped and a fresh array
 * on every render would defeat it.
 */
export function remarkPluginsFor(profile: MarkdownProfile) {
  return profile === 'doc' ? docRemarkPlugins : userRemarkPlugins;
}

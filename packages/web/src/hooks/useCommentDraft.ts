import { useDraft } from './useDraft';

/**
 * Persists comment draft text in localStorage, keyed by ticketId.
 * Survives tab switches and page reloads.
 *
 * Thin wrapper around the generic {@link useDraft} hook.
 */
export function useCommentDraft(ticketId: string) {
  return useDraft(`comment_draft_${ticketId}`);
}

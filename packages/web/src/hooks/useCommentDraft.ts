import { useState, useCallback } from 'react';

const DRAFT_KEY = (ticketId: string) => `comment_draft_${ticketId}`;

/**
 * Persists comment draft text in localStorage, keyed by ticketId.
 * Survives tab switches and page reloads.
 */
export function useCommentDraft(ticketId: string) {
  const key = DRAFT_KEY(ticketId);

  const [draft, setDraftState] = useState<string>(() => {
    try {
      return localStorage.getItem(key) ?? '';
    } catch {
      return '';
    }
  });

  const setDraft = useCallback(
    (value: string) => {
      setDraftState(value);
      try {
        if (value) {
          localStorage.setItem(key, value);
        } else {
          localStorage.removeItem(key);
        }
      } catch {
        // localStorage full or unavailable — ignore silently
      }
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    setDraftState('');
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }, [key]);

  return { draft, setDraft, clearDraft } as const;
}

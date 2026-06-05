import { useState, useCallback } from 'react';

function readDraft(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(key: string, value: string) {
  try {
    if (value) {
      localStorage.setItem(key, value);
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage full or unavailable — ignore silently
  }
}

/**
 * Persists draft text in localStorage under an arbitrary key.
 * Survives tab switches, view changes and full page reloads.
 *
 * Re-reads when the key changes while mounted, so a single mounted
 * component can host drafts for different entities (e.g. switching
 * between two human_gate instances) without one draft bleeding into
 * the other.
 */
export function useDraft(key: string) {
  const [state, setState] = useState<{ key: string; value: string }>(() => ({
    key,
    value: readDraft(key),
  }));

  // Key changed since last render → load the new key's draft synchronously.
  // Setting state during render (React's "adjusting state on prop change"
  // pattern) re-renders immediately, avoiding a flash of the stale value.
  let value = state.value;
  if (state.key !== key) {
    value = readDraft(key);
    setState({ key, value });
  }

  const setDraft = useCallback(
    (next: string) => {
      setState({ key, value: next });
      writeDraft(key, next);
    },
    [key],
  );

  const clearDraft = useCallback(() => {
    setState({ key, value: '' });
    writeDraft(key, '');
  }, [key]);

  return { draft: value, setDraft, clearDraft } as const;
}

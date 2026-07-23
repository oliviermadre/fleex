import { useState, useCallback, useRef, useLayoutEffect } from 'react';

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

  // Keep the latest key in a ref so `setDraft`/`clearDraft` can stay
  // identity-stable (empty dep array) while still always targeting the key
  // that is currently on screen. Without this, a consumer that memoises an
  // event handler and omits the setter from its deps (e.g. the Cockpit, where
  // TicketComments is re-used across tickets without a remount) would capture
  // the setter bound to the FIRST key forever, and every keystroke would leak
  // into the previous entity's draft. Reading the key from a ref neutralises
  // that whole class of stale-closure bug at the source.
  const keyRef = useRef(key);
  useLayoutEffect(() => {
    keyRef.current = key;
  }, [key]);

  // Key changed since last render → load the new key's draft synchronously.
  // Setting state during render (React's "adjusting state on prop change"
  // pattern) re-renders immediately, avoiding a flash of the stale value.
  let value = state.value;
  if (state.key !== key) {
    value = readDraft(key);
    setState({ key, value });
  }

  const setDraft = useCallback((next: string) => {
    const k = keyRef.current;
    setState({ key: k, value: next });
    writeDraft(k, next);
  }, []);

  const clearDraft = useCallback(() => {
    const k = keyRef.current;
    setState({ key: k, value: '' });
    writeDraft(k, '');
  }, []);

  return { draft: value, setDraft, clearDraft } as const;
}

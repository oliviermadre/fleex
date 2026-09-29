import { useEffect } from 'react';
import { appWs } from '../services/websocket';
import { useFocusStore } from '../stores/focusStore';

/**
 * Events on the board-wide `tickets` channel that can add, remove or change a
 * Focus item: ticket status/blocked changes, comments (an answer wakes an
 * agent), mention lifecycle, workflow run/step lifecycle and SDK executions.
 */
export function affectsFocus(type: string): boolean {
  return (
    type.startsWith('ticket:') ||
    type.startsWith('mention:') ||
    type.startsWith('workflow:') ||
    type.startsWith('execution:') ||
    type === 'comment:created'
  );
}

/**
 * Keeps the Focus list live app-wide — the nav badge needs it on every page, not
 * only on /focus. Mounted once in AppLayout: one fetch at start, then a debounced
 * refetch on relevant WS events. Also fires pending (undo-window) actions when
 * the page goes away, so closing the tab right after a decision doesn't drop it.
 */
export function useFocusFeed() {
  useEffect(() => {
    const store = useFocusStore.getState();
    void store.load();
    const unsub = appWs.onChannel('tickets', (msg) => {
      if (affectsFocus(msg.type)) useFocusStore.getState().scheduleReload();
    });
    const flush = () => useFocusStore.getState().flushPending();
    window.addEventListener('pagehide', flush);
    return () => {
      unsub();
      window.removeEventListener('pagehide', flush);
    };
  }, []);
}

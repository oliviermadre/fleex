import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useSessionStore } from '../stores/sessionStore';

export function useKeyboardShortcuts() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey;

      // Cmd+B: toggle sidebar
      if (meta && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
        return;
      }

      // Cmd+N: new session
      if (meta && e.key === 'n') {
        e.preventDefault();
        openCreateModal();
        return;
      }

      // Cmd+Shift+Up/Down: navigate sessions
      if (meta && e.shiftKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        if (sessions.length === 0) return;

        const currentIndex = selectedSessionId
          ? sessions.findIndex((s) => s.id === selectedSessionId)
          : -1;

        let nextIndex: number;
        if (e.key === 'ArrowUp') {
          nextIndex = currentIndex <= 0 ? sessions.length - 1 : currentIndex - 1;
        } else {
          nextIndex = currentIndex >= sessions.length - 1 ? 0 : currentIndex + 1;
        }

        const nextSession = sessions[nextIndex];
        if (nextSession) {
          selectSession(nextSession.id);
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar, openCreateModal, sessions, selectedSessionId, selectSession]);
}

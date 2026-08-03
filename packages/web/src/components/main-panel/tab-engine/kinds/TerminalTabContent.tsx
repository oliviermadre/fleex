import { useRef, useEffect } from 'react';

import { useTerminal } from '../../../../hooks/useTerminal';
import { terminalManager } from '../../../../services/terminalManager';
import { useUIStore } from '../../../../stores/uiStore';
import { FloatingSessionHint } from '../../FloatingSessionHint';

import type { TabContentProps } from '../types';

/**
 * Shared content component for any session-backed tab kind (shell, claude, …).
 * Mounts xterm.js for `tab.meta.sessionId`.
 *
 * When the session is floating, renders <FloatingSessionHint> instead of the
 * terminal div — prevents double xterm.js attach (DOM node can only live in one container).
 */
export function TerminalTabContent({ tab }: TabContentProps) {
  const sessionId = tab.meta.sessionId as string;
  const isFloating = useUIStore((s) => s.floatingSessionIds.includes(sessionId));

  const containerRef = useRef<HTMLDivElement>(null);
  // Pass null when floating to prevent useTerminal from attaching xterm
  useTerminal(isFloating ? null : sessionId, containerRef);

  useEffect(() => {
    if (isFloating) return;
    terminalManager.get(sessionId)?.terminal.focus();
  }, [sessionId, isFloating]);

  const setLastActiveSession = useUIStore((s) => s.setLastActiveSession);
  useEffect(() => {
    setLastActiveSession(sessionId);
  }, [sessionId, setLastActiveSession]);

  if (isFloating) {
    // Look up the session object for the hint component
    const session = useUIStore.getState(); // not needed — FloatingSessionHint only needs { id, displayName, tmuxName }
    // We pass a minimal session-like object; FloatingSessionHint only reads session.id, displayName, tmuxName
    return (
      <FloatingSessionHint
        session={{ id: sessionId, displayName: tab.label, tmuxName: tab.label } as any}
      />
    );
  }

  return <div ref={containerRef} className="xterm-container flex-1" />;
}

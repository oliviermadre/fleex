import { useRef } from 'react';
import { useTerminal } from '../../../hooks/useTerminal';

/**
 * Own module so SidebarBottomPanel can lazy-load it: this is the third and last
 * xterm.js consumer, and SessionRightSidebar is reachable from the eager
 * UnifiedWorktreePanel.
 */
export function SidebarTerminalView({ sessionId }: { sessionId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(sessionId, containerRef);
  return <div ref={containerRef} className="xterm-container absolute inset-0" />;
}

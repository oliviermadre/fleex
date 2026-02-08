import { memo, useRef, useEffect } from 'react';
import type { Session } from '@asm/shared';
import { useTerminal } from '../../hooks/useTerminal';
import { terminalManager } from '../../services/terminalManager';
import { SessionHeader } from './SessionHeader';
import { StatusBar } from './StatusBar';
import { cn } from '../../lib/cn';

interface Props {
  session: Session;
  focused: boolean;
  isSplit: boolean;
  onFocus: () => void;
}

export const SessionPane = memo(function SessionPane({ session, focused, isSplit, onFocus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  useTerminal(session.id, containerRef);

  // Move xterm.js DOM focus when this pane becomes focused
  useEffect(() => {
    if (focused) {
      terminalManager.get(session.id)?.terminal.focus();
    }
  }, [focused, session.id]);

  return (
    <div
      className={cn(
        'flex flex-1 flex-col overflow-hidden transition-all duration-200',
        isSplit && focused && 'session-pane-focused',
        isSplit && !focused && 'session-pane-unfocused'
      )}
      onClick={onFocus}
    >
      <SessionHeader session={session} splitFocused={isSplit && focused} />
      <div
        ref={containerRef}
        className="xterm-container flex-1"
      />
      <StatusBar session={session} splitFocused={isSplit && focused} />
    </div>
  );
});

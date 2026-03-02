import { memo, useRef, useEffect } from 'react';
import type { Session } from '@asm/shared';
import { useTerminal } from '../../hooks/useTerminal';
import { terminalManager } from '../../services/terminalManager';
import { useUIStore } from '../../stores/uiStore';
import { SessionHeader, SessionTabs } from './SessionHeader';
import { TopToolbar } from './TopToolbar';
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

  // Track last active tab per worktree (including system shells) + global last active session
  const setLastActiveTab = useUIStore((s) => s.setLastActiveTab);
  const setLastActiveSession = useUIStore((s) => s.setLastActiveSession);
  useEffect(() => {
    const isSystem = !session.repositoryOrg || !session.repositoryName || !session.worktreeBranch;
    const key = isSystem
      ? '_system'
      : `${session.repositoryOrg}/${session.repositoryName}:${session.worktreeBranch}`;
    setLastActiveTab(key, session.id);
    setLastActiveSession(session.id);
  }, [session.id, session.repositoryOrg, session.repositoryName, session.worktreeBranch, setLastActiveTab, setLastActiveSession]);

  return (
    <div
      className={cn(
        'flex flex-1 flex-col overflow-hidden transition-all duration-200',
        isSplit && focused && 'session-pane-focused',
        isSplit && !focused && 'session-pane-unfocused'
      )}
      onClick={onFocus}
    >
      <TopToolbar session={session} />
      <SessionHeader session={session} splitFocused={isSplit && focused} />
      <SessionTabs currentSession={session} />
      <div
        ref={containerRef}
        className="xterm-container flex-1"
      />
    </div>
  );
});

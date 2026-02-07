import { useSessionStore } from '../../stores/sessionStore';
import { SessionHeader } from './SessionHeader';
import { TerminalView } from './TerminalView';
import { StatusBar } from './StatusBar';
import { EmptyState } from './EmptyState';

export function MainPanel() {
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const selectedSession = sessions.find((s) => s.id === selectedSessionId) ?? null;

  if (!selectedSession) {
    return <EmptyState />;
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <SessionHeader session={selectedSession} />
      <TerminalView sessionId={selectedSession.id} />
      <StatusBar session={selectedSession} />
    </div>
  );
}

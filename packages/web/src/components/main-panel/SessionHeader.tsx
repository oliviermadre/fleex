import { useState } from 'react';
import type { Session } from '@asm/shared';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { useSessionStore } from '../../stores/sessionStore';
import * as api from '../../services/api';

interface Props {
  session: Session;
}

export function SessionHeader({ session }: Props) {
  const [confirmKill, setConfirmKill] = useState(false);
  const selectSession = useSessionStore((s) => s.selectSession);
  const removeSession = useSessionStore((s) => s.removeSession);

  const handleKill = async () => {
    if (!confirmKill) {
      setConfirmKill(true);
      setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    try {
      await api.killSession(session.id);
      removeSession(session.id);
    } catch {
      // ignore
    }
    setConfirmKill(false);
  };

  const handleClose = () => {
    selectSession(null);
  };

  // Truncate CWD path for display
  const cwdDisplay = session.cwd.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div
      className="flex items-center gap-3 border-b border-zinc-800 px-3"
      style={{ height: 'var(--header-height)' }}
    >
      <span className="text-sm font-medium text-zinc-200 truncate">
        {session.tmuxName}
      </span>
      <Badge type={session.type} />
      <span className="truncate text-xs text-zinc-500" title={session.cwd}>
        {cwdDisplay}
      </span>
      <div className="ml-auto flex items-center gap-1">
        <Button
          variant={confirmKill ? 'danger' : 'ghost'}
          size="sm"
          onClick={handleKill}
          title={confirmKill ? 'Click again to confirm' : 'Kill session'}
        >
          {confirmKill ? 'Confirm Kill' : 'Kill'}
        </Button>
        <Button variant="ghost" size="sm" onClick={handleClose} title="Close">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        </Button>
      </div>
    </div>
  );
}

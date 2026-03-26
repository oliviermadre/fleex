import { useMemo } from 'react';
import type { Session } from '@fleex/shared';
import { useUIStore } from '../../stores/uiStore';
import { useSessionStore } from '../../stores/sessionStore';
import { TerminalIcon } from './icons';
import { cn } from '../../lib/cn';
import { useNavigate } from 'react-router-dom';
import { aggregateBranchStatus } from '../../lib/deriveStatus';
import { StatusDot } from '../ui/StatusDot';
import * as api from '../../services/api';
import { useSettingsStore } from '../../stores/settingsStore';

const SYSTEM_GROUP_ID = '_system';
const SYSTEM_WORKTREE_KEY = '_system';

interface Props {
  sessions: Session[];
}

/**
 * Compact single-line system shells entry.
 * Rendered under the "System" section divider in SessionGroups.
 */
export function SystemGroup({ sessions }: Props) {
  const navigate = useNavigate();
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const lastActiveTab = useUIStore((s) => s.lastActiveTabByWorktree[SYSTEM_WORKTREE_KEY]);
  const addSessionToGroup = useSessionStore((s) => s.addSessionToGroup);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const basePath = useSettingsStore((s) => s.settings.basePath);

  const branchStatus = useMemo(() => aggregateBranchStatus(sessions), [sessions]);
  const isSelected = sessions.some((s) => s.id === selectedSessionId);

  const handleClick = () => {
    if (sessions.length === 0) {
      const cwd = basePath || '/tmp';
      api.createSession({ cwd, type: 'shell' }).then((session) => {
        addSessionToGroup(session);
        navigate(`/sessions/${session.id}`, { replace: true });
        api.fetchSessionGroups().then(setSessionGroups).catch(() => {});
      }).catch(() => {});
      return;
    }
    const targetId = lastActiveTab && sessions.some((s) => s.id === lastActiveTab)
      ? lastActiveTab
      : sessions[0]!.id;
    navigate(`/sessions/${targetId}`, { replace: true });
  };

  return (
    <button
      className={cn(
        'flex min-w-0 w-full items-center gap-2 py-2 pl-6 pr-3 text-left transition-colors border-l-2',
        isSelected
          ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
          : 'border-transparent hover:bg-[var(--theme-bg-hover)]'
      )}
      onClick={handleClick}
    >
      <TerminalIcon size={14} className="shrink-0 text-[var(--theme-text-secondary)]" />
      <span className="truncate text-sm font-semibold font-mono text-[var(--theme-text-primary)]">Shells</span>
      <StatusDot status={branchStatus.status} />
      <span className={`text-xs ${branchStatus.textColor}`}>{branchStatus.label}</span>
      <span className="ml-auto shrink-0 text-xs text-[var(--theme-text-faint)]">{sessions.length}</span>
    </button>
  );
}

export { SYSTEM_GROUP_ID, SYSTEM_WORKTREE_KEY };

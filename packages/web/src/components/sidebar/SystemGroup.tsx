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

export function SystemGroup({ sessions }: Props) {
  const collapsedGroups = useUIStore((s) => s.collapsedGroups);
  const toggleGroup = useUIStore((s) => s.toggleGroup);
  const collapsed = collapsedGroups.has(SYSTEM_GROUP_ID);

  return (
    <div className="my-1.5">
      {/* Repo-like header */}
      <button
        className="flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-[var(--theme-bg-hover)]"
        onClick={() => toggleGroup(SYSTEM_GROUP_ID)}
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="currentColor"
          className={cn(
            'text-[var(--theme-text-muted)] transition-transform',
            collapsed ? 'rotate-0' : 'rotate-90'
          )}
        >
          <path d="M3 1l5 4-5 4V1z" />
        </svg>
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          System
        </span>
      </button>
      {!collapsed && (
        <SystemWorktreeItem sessions={sessions} />
      )}
    </div>
  );
}

/** Single worktree-like row for all system shells */
function SystemWorktreeItem({ sessions }: { sessions: Session[] }) {
  const navigate = useNavigate();
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const lastActiveTab = useUIStore((s) => s.lastActiveTabByWorktree[SYSTEM_WORKTREE_KEY]);

  const branchStatus = useMemo(() => aggregateBranchStatus(sessions), [sessions]);
  const isSelected = sessions.some((s) => s.id === selectedSessionId);

  const addSessionToGroup = useSessionStore((s) => s.addSessionToGroup);
  const setSessionGroups = useSessionStore((s) => s.setSessionGroups);
  const basePath = useSettingsStore((s) => s.settings.basePath);

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
    <div>
      <div className="group/wt relative">
        <button
          className={cn(
            'flex min-w-0 w-full flex-col gap-0.5 py-2.5 pl-6 pr-3 text-left transition-colors border-l-2',
            isSelected
              ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
              : 'border-transparent hover:bg-[var(--theme-bg-hover)]'
          )}
          onClick={handleClick}
        >
          {/* Row 1: Name */}
          <div className="flex items-center gap-1.5">
            <TerminalIcon size={14} className="shrink-0 text-[var(--theme-text-secondary)]" />
            <span className="truncate text-sm font-semibold font-mono text-[var(--theme-text-primary)]">Shells</span>
          </div>

          {/* Row 2: Status dot + label + count */}
          <div className="flex items-center gap-1.5 pl-5">
            <StatusDot status={branchStatus.status} />
            <span className={`text-xs ${branchStatus.textColor}`}>{branchStatus.label}</span>
            <span className="ml-auto shrink-0 text-xs text-[var(--theme-text-faint)]">{sessions.length}</span>
          </div>
        </button>
      </div>
    </div>
  );
}

export { SYSTEM_GROUP_ID, SYSTEM_WORKTREE_KEY };

import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@asm/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { ClaudeIcon, TerminalIcon, getProcessIcon } from './icons';
import { ActivityDot } from './ActivityDot';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';

function GroupBindIndicator() {
  return (
    <span className="ml-auto shrink-0 text-[8px] text-[var(--theme-accent)] font-bold uppercase tracking-wider">
      bind
    </span>
  );
}

interface Props {
  session: Session;
}

export function SessionItem({ session }: Props) {
  const navigate = useNavigate();
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const splitSessionId = useSessionStore((s) => s.splitSessionId);
  const setFocusedPane = useSessionStore((s) => s.setFocusedPane);
  const displayNames = useSettingsStore((s) => s.settings.sessionDisplayNames);
  const setSessionDisplayName = useSettingsStore((s) => s.setSessionDisplayName);
  const focusedPane = useSessionStore((s) => s.focusedPane);
  const isSelected = selectedSessionId === session.id;
  const isSplit = splitSessionId === session.id;
  const inSplitMode = splitSessionId !== null;
  const isFocusedInSplit = inSplitMode && (
    (isSelected && focusedPane === 'primary') ||
    (isSplit && focusedPane === 'split')
  );

  const removeSession = useSessionStore((s) => s.removeSession);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const bindLayoutGroupCell = useSettingsStore((s) => s.bindLayoutGroupCell);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);
  const hasActiveGroupCell = selectedGroupId !== null && activeGroupCellIndex !== null;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [confirmKill, setConfirmKill] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const killTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const handleKill = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirmKill) {
      setConfirmKill(true);
      killTimerRef.current = setTimeout(() => setConfirmKill(false), 3000);
      return;
    }
    clearTimeout(killTimerRef.current);
    try {
      await api.killSession(session.id);
      removeSession(session.id);
    } catch {
      // ignore
    }
    setConfirmKill(false);
  }, [confirmKill, session.id, removeSession]);

  const displayName = session.displayName || displayNames[session.id] || session.tmuxName;

  const isRunning = session.status === 'running';
  const isClaude = session.type !== 'shell';

  const isHighlighted = isSelected || isSplit;

  const iconColor = isRunning
    ? isClaude
      ? 'text-[var(--theme-accent)]'
      : isHighlighted ? 'text-emerald-400' : 'text-emerald-400/60'
    : isHighlighted ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-faint)]';

  const startEditing = useCallback(() => {
    setEditValue(displayName);
    setEditing(true);
  }, [displayName]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.tmuxName) {
      setSessionDisplayName(session.id, trimmed);
    } else if (!trimmed || trimmed === session.tmuxName) {
      setSessionDisplayName(session.id, '');
    }
    setEditing(false);
  }, [editValue, session.id, session.tmuxName, setSessionDisplayName]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
  }, []);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commitEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    },
    [commitEdit, cancelEdit]
  );

  return (
    <button
      className={cn(
        'group/session flex w-full items-center gap-2 px-3 py-1.5 text-left transition-all duration-200 border-l-3',
        (isSelected || isSplit)
          ? isFocusedInSplit
            ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
            : inSplitMode
              ? 'border-[var(--theme-border)] bg-[var(--theme-bg-hover)] text-[var(--theme-text-muted)] opacity-60'
              : 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)] text-[var(--theme-text-primary)]'
          : 'border-transparent text-[var(--theme-text-muted)] hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]'
      )}
      onClick={(e) => {
        // Shift+click while a group cell is active: bind session to that cell
        if (e.shiftKey && hasActiveGroupCell) {
          bindLayoutGroupCell(selectedGroupId, activeGroupCellIndex, session.id);
          setActiveGroupCellIndex(null);
          return;
        }
        // Shift+click: open in split pane
        if (e.shiftKey && selectedSessionId && selectedSessionId !== session.id) {
          navigate(`/sessions/${selectedSessionId}?split=${session.id}`, { replace: true });
          return;
        }
        // If clicking on a session already visible in split, just focus that pane
        if (isSelected) {
          setFocusedPane('primary');
          return;
        }
        if (isSplit) {
          setFocusedPane('split');
          return;
        }
        // Normal click: select session (exits split mode)
        navigate(`/sessions/${session.id}`, { replace: true });
      }}
      onDoubleClick={(e) => {
        e.preventDefault();
        startEditing();
      }}
    >
      <span
        className="relative flex h-4 w-4 shrink-0 items-center justify-center"
        title={session.foregroundProcess || (isClaude ? 'Claude' : 'Shell')}
      >
        {(() => {
          const ProcessIcon = getProcessIcon(session.foregroundProcess);
          const fgIsShell = !!session.foregroundProcess && ['zsh', 'bash', 'fish'].includes(session.foregroundProcess.split(' ')[0] ?? '');
          const IconComponent = ProcessIcon || (fgIsShell ? TerminalIcon : (isClaude ? ClaudeIcon : TerminalIcon));
          const isClaudeIcon = IconComponent === ClaudeIcon;
          const color = isClaudeIcon
            ? (isRunning ? 'text-[var(--theme-accent)]' : isHighlighted ? 'text-[var(--theme-text-secondary)]' : 'text-[var(--theme-text-faint)]')
            : (isRunning ? (isHighlighted ? 'text-emerald-400' : 'text-emerald-400/60') : iconColor);
          return <IconComponent size={14} className={color} />;
        })()}
        {isClaude && isRunning && session.claudeActivity && (
          <ActivityDot status={session.claudeActivity} />
        )}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-[var(--theme-accent)] bg-[var(--theme-bg-surface)] px-1 py-0 text-xs text-[var(--theme-text-primary)] outline-none"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11px] leading-4">
          {displayName}
          {session.foregroundProcess && (
            <span className="text-[var(--theme-text-faint)] text-[10px]"> ({session.foregroundProcess.split(' ')[0]})</span>
          )}
        </span>
      )}
      {hasActiveGroupCell && (
        <GroupBindIndicator />
      )}
      <span
        role="button"
        tabIndex={-1}
        className={cn(
          'hidden shrink-0 items-center justify-center rounded transition-colors group-hover/session:flex',
          confirmKill
            ? 'text-red-400 hover:text-red-300'
            : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)]'
        )}
        onClick={handleKill}
        onDoubleClick={(e) => e.stopPropagation()}
        title={confirmKill ? 'Click again to confirm kill' : 'Kill session'}
      >
        {confirmKill ? (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="8" cy="8" r="6" />
            <line x1="5.5" y1="5.5" x2="10.5" y2="10.5" />
            <line x1="10.5" y1="5.5" x2="5.5" y2="10.5" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="4" y1="4" x2="12" y2="12" />
            <line x1="12" y1="4" x2="4" y2="12" />
          </svg>
        )}
      </span>
    </button>
  );
}

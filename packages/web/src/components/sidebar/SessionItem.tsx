import { useState, useRef, useEffect, useCallback } from 'react';
import type { Session } from '@asm/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { ClaudeIcon, TerminalIcon } from './icons';
import { ActivityDot } from './ActivityDot';
import { cn } from '../../lib/cn';
import * as api from '../../services/api';

interface Props {
  session: Session;
}

export function SessionItem({ session }: Props) {
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);
  const displayNames = useSettingsStore((s) => s.settings.sessionDisplayNames);
  const setSessionDisplayName = useSettingsStore((s) => s.setSessionDisplayName);
  const isSelected = selectedSessionId === session.id;

  const removeSession = useSessionStore((s) => s.removeSession);

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

  const displayName = displayNames[session.id] || session.tmuxName;

  const isRunning = session.status === 'running';
  const isClaude = session.type !== 'shell';

  const iconColor = isRunning
    ? isClaude
      ? 'text-[#D77655]'
      : isSelected ? 'text-emerald-400' : 'text-emerald-400/60'
    : isSelected ? 'text-zinc-400' : 'text-zinc-600';

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
        'group/session flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors border-l-2',
        isSelected
          ? 'border-[#D77655] bg-zinc-800/80 text-zinc-50'
          : 'border-transparent text-zinc-500 hover:bg-zinc-800/40 hover:text-zinc-300'
      )}
      onClick={() => selectSession(session.id)}
      onDoubleClick={(e) => {
        e.preventDefault();
        startEditing();
      }}
    >
      <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
        {isClaude
          ? <ClaudeIcon size={14} className={iconColor} />
          : <TerminalIcon size={14} className={iconColor} />
        }
        {isClaude && isRunning && session.claudeActivity && (
          <ActivityDot status={session.claudeActivity} />
        )}
      </span>
      {editing ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-[#D77655]/50 bg-zinc-900 px-1 py-0 text-xs text-zinc-100 outline-none"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11px] leading-4">
          {displayName}
        </span>
      )}
      <span
        role="button"
        tabIndex={-1}
        className={cn(
          'hidden shrink-0 items-center justify-center rounded transition-colors group-hover/session:flex',
          confirmKill
            ? 'text-red-400 hover:text-red-300'
            : 'text-zinc-500 hover:text-zinc-200'
        )}
        onClick={handleKill}
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

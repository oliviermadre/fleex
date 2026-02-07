import { useState, useRef, useEffect, useCallback } from 'react';
import type { Session } from '@asm/shared';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { formatAge } from '../../lib/formatAge';
import { cn } from '../../lib/cn';

interface Props {
  session: Session;
}

export function SessionItem({ session }: Props) {
  const selectedSessionId = useSessionStore((s) => s.selectedSessionId);
  const selectSession = useSessionStore((s) => s.selectSession);
  const displayNames = useSettingsStore((s) => s.settings.sessionDisplayNames);
  const setSessionDisplayName = useSettingsStore((s) => s.setSessionDisplayName);
  const isSelected = selectedSessionId === session.id;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const displayName = displayNames[session.id] || session.tmuxName;

  const dotColor = session.type === 'shell' ? 'bg-emerald-500' : 'bg-violet-500';
  const deadDotColor = 'bg-zinc-600';

  const startEditing = useCallback(() => {
    setEditValue(displayName);
    setEditing(true);
  }, [displayName]);

  const commitEdit = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== session.tmuxName) {
      setSessionDisplayName(session.id, trimmed);
    } else if (!trimmed || trimmed === session.tmuxName) {
      // Reset to default (remove override)
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
        'flex w-full items-center gap-2 px-4 py-1 text-left transition-colors',
        isSelected
          ? 'bg-zinc-800 text-zinc-100'
          : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-300'
      )}
      onClick={() => selectSession(session.id)}
      onDoubleClick={(e) => {
        e.preventDefault();
        startEditing();
      }}
    >
      <span
        className={cn(
          'h-2 w-2 shrink-0 rounded-full',
          session.status === 'running' ? dotColor : deadDotColor
        )}
      />
      {editing ? (
        <input
          ref={inputRef}
          className="min-w-0 flex-1 rounded border border-violet-500/50 bg-zinc-900 px-1 py-0 text-[11px] text-zinc-100 outline-none"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={commitEdit}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate text-[11px]">
          {displayName}
        </span>
      )}
      <span className="shrink-0 text-[10px] text-zinc-600">
        {formatAge(session.createdAt)}
      </span>
    </button>
  );
}

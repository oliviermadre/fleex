import { useEffect, useState } from 'react';

import { cn } from '../../lib/cn';
import { tintSolid, tintText } from '../../lib/tints';
import { useAssistantStore, type AssistantSession } from '../../stores/assistantStore';
import { useUIStore } from '../../stores/uiStore';

/** "x unit ago" relative time, matching the comment feed's tone. */
export function relativeTime(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

/** Idle vs answering indicator: pulses while the LLM is working. */
export function AssistantStatusDot({
  status,
  size = 8,
}: {
  status: AssistantSession['status'];
  size?: number;
}) {
  const working = status !== 'idle';
  return (
    <span
      className={cn(
        'inline-block shrink-0 rounded-full',
        working
          ? cn('animate-pulse', tintSolid('yellow'))
          : 'bg-[var(--theme-text-faint)] opacity-40',
      )}
      style={{ width: size, height: size }}
      title={
        status === 'idle'
          ? 'Inactif'
          : status === 'awaiting_input'
            ? 'En attente de confirmation'
            : 'En train de répondre'
      }
    />
  );
}

export function AssistantSidebar() {
  const toggleContentPanel = useUIStore((s) => s.toggleContentPanel);
  const connected = useAssistantStore((s) => s.connected);
  const sessions = useAssistantStore((s) => s.sessions);
  const activeId = useAssistantStore((s) => s.activeId);
  const ensureConnected = useAssistantStore((s) => s.ensureConnected);
  const newSession = useAssistantStore((s) => s.newSession);
  const openSession = useAssistantStore((s) => s.openSession);
  const deleteSession = useAssistantStore((s) => s.deleteSession);
  const renameSession = useAssistantStore((s) => s.renameSession);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    ensureConnected();
  }, [ensureConnected]);

  const commitRename = () => {
    if (renamingId && renameValue.trim()) renameSession(renamingId, renameValue);
    setRenamingId(null);
    setRenameValue('');
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      setTimeout(() => setConfirmDeleteId((cur) => (cur === id ? null : cur)), 2500);
      return;
    }
    setConfirmDeleteId(null);
    deleteSession(id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div
        className="flex items-center justify-between border-b border-[var(--theme-border)] px-4"
        style={{ height: 'var(--header-height)' }}
      >
        <span className="text-xs font-bold uppercase tracking-wider text-[var(--theme-text-muted)]">
          Assistant
        </span>
        <div className="flex items-center gap-1">
          {/* New conversation */}
          <button
            className="rounded p-1 text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            onClick={() => newSession()}
            title="Nouvelle conversation"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
          {/* Collapse */}
          <button
            onClick={toggleContentPanel}
            className="flex h-6 w-6 items-center justify-center rounded text-[var(--theme-text-muted)] transition-colors hover:bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-secondary)]"
            title="Collapse panel"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" />
              <line x1="6" y1="1.5" x2="6" y2="14.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto py-1">
        {!connected ? (
          <p className="px-4 py-6 text-center text-xs text-[var(--theme-text-faint)]">
            Companion injoignable — lance <code>fleex companion start</code>.
            <br />
            Reconnexion automatique…
          </p>
        ) : sessions.length === 0 ? (
          <div className="px-4 py-6 text-center">
            <p className="mb-2 text-xs text-[var(--theme-text-faint)]">Aucune conversation</p>
            <button
              onClick={() => newSession()}
              className="rounded-md bg-[var(--theme-accent)] px-3 py-1.5 text-xs font-medium text-[var(--theme-accent-fg)] transition-colors hover:bg-[var(--theme-accent-hover)]"
            >
              Nouvelle conversation
            </button>
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              className={cn(
                'group flex cursor-pointer items-center gap-2 border-l-2 px-3 py-2 transition-colors',
                s.id === activeId
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-bg-hover)]'
                  : 'border-transparent hover:bg-[var(--theme-bg-hover)]',
              )}
              onClick={() => openSession(s.id)}
            >
              <AssistantStatusDot status={s.status} />
              <div className="min-w-0 flex-1">
                {renamingId === s.id ? (
                  <input
                    autoFocus
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') {
                        setRenamingId(null);
                        setRenameValue('');
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full rounded border border-[var(--theme-accent)] bg-[var(--theme-bg-surface)] px-1.5 py-0.5 text-xs text-[var(--theme-text-primary)] outline-none"
                  />
                ) : (
                  <p className="truncate text-xs font-medium text-[var(--theme-text-primary)]">
                    {s.title}
                  </p>
                )}
                <p className="truncate text-[10px] text-[var(--theme-text-faint)]">
                  {s.messageCount} message{s.messageCount > 1 ? 's' : ''}
                  {' · '}
                  {relativeTime(s.lastMessageAt ?? s.createdAt)}
                  {s.workspace ? ` · ${s.workspace}` : ''}
                </p>
              </div>
              {/* Rename */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setRenamingId(s.id);
                  setRenameValue(s.title);
                }}
                className="hidden shrink-0 rounded p-1 text-[var(--theme-text-faint)] hover:text-[var(--theme-text-secondary)] group-hover:block"
                title="Renommer"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M11.5 2.5l2 2L6 12l-2.7.7L4 10l7.5-7.5z" />
                </svg>
              </button>
              {/* Delete */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDelete(s.id);
                }}
                className={cn(
                  'shrink-0 rounded p-1',
                  confirmDeleteId === s.id
                    ? cn('block text-[10px] font-semibold', tintText('red'))
                    : 'hidden text-[var(--theme-text-faint)] hover:text-[var(--theme-danger)] group-hover:block',
                )}
                title="Supprimer la conversation"
              >
                {confirmDeleteId === s.id ? (
                  'Sûr ?'
                ) : (
                  <svg
                    width="12"
                    height="12"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  >
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

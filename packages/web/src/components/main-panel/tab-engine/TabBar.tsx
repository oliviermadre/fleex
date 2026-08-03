import { useState, useCallback, useRef } from 'react';

import { cn } from '../../../lib/cn';
import { useUIStore } from '../../../stores/uiStore';

import { getTabKind } from './registry';

import type { TabDescriptor } from './types';
import type { TabDragState } from './useTabEngine';

// ——— Props ———

interface TabBarProps {
  tabs: TabDescriptor[];
  activeTabKey: string | null;
  onSelect: (tab: TabDescriptor) => void;
  onClose?: (tab: TabDescriptor) => void;
  onRename?: (tab: TabDescriptor, newName: string) => void;
  /** Slot rendered after the last tab (e.g. SmartSessionButton). Replaces the old onNewTab button. */
  trailing?: React.ReactNode;
  drag: TabDragState;
}

// ——— Single tab with inline rename ———

interface TabItemProps {
  tab: TabDescriptor;
  isActive: boolean;
  onSelect: () => void;
  onClose?: () => void;
  onRename?: (newName: string) => void;
  drag: TabDragState;
}

function TabItem({ tab, isActive, onSelect, onClose, onRename, drag }: TabItemProps) {
  const kind = getTabKind(tab.kind);

  // Floating overlay toggle (session-backed tabs only)
  const sessionId = tab.capabilities.floatable
    ? (tab.meta.sessionId as string | undefined)
    : undefined;
  const isFloating = useUIStore((s) =>
    sessionId ? s.floatingSessionIds.includes(sessionId) : false,
  );
  const addFloatingSession = useUIStore((s) => s.addFloatingSession);
  const removeFloatingSession = useUIStore((s) => s.removeFloatingSession);
  const toggleFloating = useCallback(() => {
    if (!sessionId) return;
    if (isFloating) removeFloatingSession(sessionId);
    else addFloatingSession(sessionId);
  }, [sessionId, isFloating, addFloatingSession, removeFloatingSession]);

  // Inline rename state
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  const startEditing = useCallback(() => {
    if (!tab.capabilities.renamable) return;
    setEditValue(tab.label);
    setEditing(true);
  }, [tab.capabilities.renamable, tab.label]);

  const commitRename = useCallback(() => {
    setEditing(false);
    const trimmed = editValue.trim();
    if (!trimmed || trimmed === tab.label) return;
    onRename?.(trimmed);
  }, [editValue, tab.label, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') commitRename();
      else if (e.key === 'Escape') setEditing(false);
    },
    [commitRename],
  );

  const setInputRefCb = useCallback((el: HTMLInputElement | null) => {
    inputRef.current = el;
    if (el) {
      el.focus();
      el.select();
    }
  }, []);

  const key = tab.key;
  const isOver = drag.dragOverKey === key && drag.draggedKeyRef.current !== key;
  const Icon = kind?.Icon;
  const StatusIndicator = kind?.StatusIndicator;

  return (
    <div
      draggable={tab.capabilities.orderable}
      onDragStart={drag.handleDragStart(key)}
      onDragEnd={drag.handleDragEnd}
      onDragOver={drag.handleDragOver(key)}
      onDragLeave={drag.handleDragLeave(key)}
      onDrop={drag.handleDrop(key)}
      className="relative"
    >
      {isOver && drag.dropEdge === 'left' && (
        <div className="absolute left-0 top-1 bottom-1 z-10 w-0.5 rounded bg-[var(--theme-accent)]" />
      )}

      <div
        className={cn(
          'group/tab relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap transition-colors cursor-pointer',
          isActive
            ? 'text-[var(--theme-text-primary)]'
            : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]',
        )}
        onClick={() => {
          if (!editing) onSelect();
        }}
        onMouseDown={(e) => {
          if (e.button === 1 && tab.capabilities.closable && onClose) {
            e.preventDefault();
            onClose();
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          startEditing();
        }}
      >
        {/* Kind icon */}
        {Icon && <Icon tab={tab} />}

        {/* Label or inline rename input */}
        {editing ? (
          <input
            ref={setInputRefCb}
            className="w-[100px] bg-transparent text-xs text-[var(--theme-text-primary)] outline-none border-b border-[var(--theme-accent)]"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate max-w-[120px]">{tab.label}</span>
        )}

        {/* Execution event count (kind-specific extra info from meta) */}
        {tab.meta.eventCount != null && (
          <span className="text-[var(--theme-text-faint)]">({tab.meta.eventCount as number})</span>
        )}

        {/* Status indicator / close (+ detach) button slot — fixed size, never grows the tab; hover row overlaps leftward over the label instead */}
        <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          {/* Status indicator (default state) */}
          {StatusIndicator && (
            <span className={tab.capabilities.closable ? 'group-hover/tab:hidden' : ''}>
              <StatusIndicator tab={tab} />
            </span>
          )}
          {/* Hover row: detach (if floatable) + close (if closable) */}
          {(tab.capabilities.floatable || (tab.capabilities.closable && onClose)) && (
            <span
              className={cn(
                'hidden items-center justify-end gap-0.5 group-hover/tab:flex absolute z-10',
                tab.capabilities.floatable ? 'right-0 top-0 h-4 w-[34px]' : 'inset-0',
              )}
            >
              {tab.capabilities.floatable && (
                <button
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded bg-[var(--theme-bg-surface)] transition-colors hover:bg-[var(--theme-bg-overlay)]',
                    isFloating
                      ? 'text-[var(--theme-accent)]'
                      : 'text-[var(--theme-text-faint)] hover:text-[var(--theme-accent)]',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFloating();
                  }}
                  title={isFloating ? 'Re-attach to main panel' : 'Detach to floating overlay'}
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.75"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="2" y="2" width="9" height="9" rx="1.5" />
                    <path d="M13 7V3h-4" />
                    <line x1="13" y1="3" x2="7" y2="9" />
                  </svg>
                </button>
              )}
              {tab.capabilities.closable && onClose && (
                <button
                  className={cn(
                    'flex h-4 w-4 items-center justify-center rounded text-[var(--theme-text-faint)] transition-colors hover:bg-[var(--theme-bg-overlay)] hover:text-[var(--theme-text-primary)]',
                    tab.capabilities.floatable && 'bg-[var(--theme-bg-surface)]',
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose();
                  }}
                  title="Close tab"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  >
                    <line x1="4" y1="4" x2="12" y2="12" />
                    <line x1="12" y1="4" x2="4" y2="12" />
                  </svg>
                </button>
              )}
            </span>
          )}
        </span>

        {/* Active tab indicator */}
        {isActive && (
          <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
        )}
      </div>

      {isOver && drag.dropEdge === 'right' && (
        <div className="absolute right-0 top-1 bottom-1 z-10 w-0.5 rounded bg-[var(--theme-accent)]" />
      )}
    </div>
  );
}

// ——— Tab Bar ———

export function TabBar({
  tabs,
  activeTabKey,
  onSelect,
  onClose,
  onRename,
  trailing,
  drag,
}: TabBarProps) {
  return (
    <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] px-2 overflow-x-auto">
      {tabs.map((tab) => (
        <TabItem
          key={tab.key}
          tab={tab}
          isActive={tab.key === activeTabKey}
          onSelect={() => onSelect(tab)}
          onClose={onClose ? () => onClose(tab) : undefined}
          onRename={onRename ? (name) => onRename(tab, name) : undefined}
          drag={drag}
        />
      ))}

      {/* Trailing slot (e.g. SmartSessionButton) */}
      {trailing && <div className="flex items-center px-1 py-1">{trailing}</div>}
    </div>
  );
}

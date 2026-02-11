import { useState } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { SessionLayoutGroup, SessionLayoutType } from '../../stores/settingsStore';
import { cn } from '../../lib/cn';

function CellGrid({ group, selectedGroupId, activeGroupCellIndex, onCellClick }: {
  group: SessionLayoutGroup;
  selectedGroupId: string | null;
  activeGroupCellIndex: number | null;
  onCellClick: (groupId: string, cellIndex: number) => void;
}) {
  const displayNames = useSettingsStore((s) => s.settings.sessionDisplayNames);
  const sessions = useSessionStore((s) => s.sessions);
  const isGroupSelected = selectedGroupId === group.id;

  const getCellLabel = (sessionId: string | null): string | null => {
    if (!sessionId) return null;
    if (displayNames[sessionId]) return displayNames[sessionId];
    const session = sessions.find((s) => s.id === sessionId);
    return session?.tmuxName ?? null;
  };

  if (group.type === '1x2') {
    return (
      <div className="flex gap-0.5">
        {group.cells.map((cellSessionId, i) => {
          const label = getCellLabel(cellSessionId);
          const isActiveCell = isGroupSelected && activeGroupCellIndex === i;
          return (
            <button
              key={i}
              className={cn(
                'h-5 flex-1 rounded-sm border text-[8px] leading-none truncate px-0.5 transition-colors cursor-pointer',
                isActiveCell
                  ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
                  : cellSessionId
                    ? 'border-[var(--theme-border)] bg-[var(--theme-bg-hover)]'
                    : 'border-[var(--theme-border)] border-dashed bg-transparent'
              )}
              title={label ?? 'Empty — click then shift-click a session to bind'}
              onClick={(e) => {
                e.stopPropagation();
                onCellClick(group.id, i);
              }}
            >
              <span className="text-[var(--theme-text-muted)] truncate">
                {label ?? ''}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // 2x2
  return (
    <div className="grid grid-cols-2 gap-0.5">
      {group.cells.map((cellSessionId, i) => {
        const label = getCellLabel(cellSessionId);
        const isActiveCell = isGroupSelected && activeGroupCellIndex === i;
        return (
          <button
            key={i}
            className={cn(
              'h-4 rounded-sm border text-[7px] leading-none truncate px-0.5 transition-colors cursor-pointer',
              isActiveCell
                ? 'border-[var(--theme-accent)] bg-[var(--theme-accent-muted)]'
                : cellSessionId
                  ? 'border-[var(--theme-border)] bg-[var(--theme-bg-hover)]'
                  : 'border-[var(--theme-border)] border-dashed bg-transparent'
            )}
            title={label ?? 'Empty — click then shift-click a session to bind'}
            onClick={(e) => {
              e.stopPropagation();
              onCellClick(group.id, i);
            }}
          >
            <span className="text-[var(--theme-text-muted)] truncate">
              {label ?? ''}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function GroupedSessions() {
  const layoutGroups = useSettingsStore((s) => s.settings.sessionLayoutGroups);
  const addLayoutGroup = useSettingsStore((s) => s.addLayoutGroup);
  const removeLayoutGroup = useSettingsStore((s) => s.removeLayoutGroup);
  const selectedGroupId = useSessionStore((s) => s.selectedGroupId);
  const activeGroupCellIndex = useSessionStore((s) => s.activeGroupCellIndex);
  const selectGroup = useSessionStore((s) => s.selectGroup);
  const setActiveGroupCellIndex = useSessionStore((s) => s.setActiveGroupCellIndex);

  const [showCreateMenu, setShowCreateMenu] = useState(false);

  const handleCellClick = (groupId: string, cellIndex: number) => {
    selectGroup(groupId);
    setActiveGroupCellIndex(cellIndex);
  };

  const handleGroupClick = (groupId: string) => {
    selectGroup(groupId);
  };

  const handleDelete = (e: React.MouseEvent, groupId: string) => {
    e.stopPropagation();
    removeLayoutGroup(groupId);
    if (selectedGroupId === groupId) {
      selectGroup(null);
    }
  };

  const handleCreate = (type: SessionLayoutType) => {
    const id = addLayoutGroup(type);
    selectGroup(id);
    setShowCreateMenu(false);
  };

  if (layoutGroups.length === 0 && !showCreateMenu) {
    return (
      <div className="px-3 pt-2 pb-1">
        <div className="mb-2 h-px bg-[var(--theme-border)]" />
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">
            Grouped
          </span>
          <button
            className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
            onClick={() => setShowCreateMenu(true)}
            title="Create grouped session layout"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="8" y1="3" x2="8" y2="13" />
              <line x1="3" y1="8" x2="13" y2="8" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 pt-2 pb-1">
      <div className="mb-2 h-px bg-[var(--theme-border)]" />
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--theme-text-faint)]">
          Grouped
        </span>
        <button
          className="text-[var(--theme-text-muted)] hover:text-[var(--theme-text-primary)] transition-colors cursor-pointer"
          onClick={() => setShowCreateMenu(!showCreateMenu)}
          title="Create grouped session layout"
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="8" y1="3" x2="8" y2="13" />
            <line x1="3" y1="8" x2="13" y2="8" />
          </svg>
        </button>
      </div>

      {showCreateMenu && (
        <div className="mb-2 flex gap-1.5">
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-[var(--theme-text-muted)] bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-accent-muted)] transition-colors cursor-pointer"
            onClick={() => handleCreate('1x2')}
            title="Side by side (2 panes)"
          >
            <span className="flex gap-px">
              <span className="block h-3 w-3 rounded-sm border border-current" />
              <span className="block h-3 w-3 rounded-sm border border-current" />
            </span>
            1×2
          </button>
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium text-[var(--theme-text-muted)] bg-[var(--theme-bg-hover)] hover:text-[var(--theme-text-primary)] hover:bg-[var(--theme-accent-muted)] transition-colors cursor-pointer"
            onClick={() => handleCreate('2x2')}
            title="Grid (4 panes)"
          >
            <span className="grid grid-cols-2 gap-px">
              <span className="block h-2 w-2 rounded-sm border border-current" />
              <span className="block h-2 w-2 rounded-sm border border-current" />
              <span className="block h-2 w-2 rounded-sm border border-current" />
              <span className="block h-2 w-2 rounded-sm border border-current" />
            </span>
            2×2
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {layoutGroups.map((group) => {
          const isSelected = selectedGroupId === group.id;
          return (
            <div
              key={group.id}
              className={cn(
                'group/grouped flex items-center gap-2 rounded px-2 py-1.5 transition-colors cursor-pointer',
                isSelected
                  ? 'bg-[var(--theme-accent-muted)] border-l-2 border-[var(--theme-accent)]'
                  : 'hover:bg-[var(--theme-bg-hover)] border-l-2 border-transparent'
              )}
              onClick={() => handleGroupClick(group.id)}
            >
              {/* Layout type indicator */}
              <span className="shrink-0 text-[10px] font-mono text-[var(--theme-text-faint)]">
                {group.type === '1x2' ? '1×2' : '2×2'}
              </span>

              {/* Cell grid */}
              <div className="flex-1 min-w-0">
                <CellGrid
                  group={group}
                  selectedGroupId={selectedGroupId}
                  activeGroupCellIndex={activeGroupCellIndex}
                  onCellClick={handleCellClick}
                />
              </div>

              {/* Delete button */}
              <button
                className="hidden shrink-0 items-center justify-center rounded text-[var(--theme-text-muted)] hover:text-red-400 transition-colors group-hover/grouped:flex cursor-pointer"
                onClick={(e) => handleDelete(e, group.id)}
                title="Delete group"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="4" y1="4" x2="12" y2="12" />
                  <line x1="12" y1="4" x2="4" y2="12" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

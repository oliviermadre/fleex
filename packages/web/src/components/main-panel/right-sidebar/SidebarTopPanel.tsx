import { useMemo, useEffect } from 'react';

import { useSidebarTerminalsStore } from '../../../stores/sidebarTerminalsStore';
import { useUIStore } from '../../../stores/uiStore';
import { ScratchpadContent } from '../../scratchpad/ScratchpadContent';

interface ScratchpadTab {
  /** Logical store key — '__global__' or 'org/name'. */
  key: string;
  /** Short label shown in the tab strip. */
  label: string;
}

interface Props {
  /** Parent tmux session — the active top tab is persisted per parent. */
  parentSessionId: string;
  /**
   * Repo keys (e.g. 'org/name') assigned to the parent ticket, in display order.
   * One scratchpad tab is rendered per repo, in addition to the Global tab.
   */
  repoKeys: string[];
  /**
   * Repo key of the current worktree session — used as the default active tab
   * the first time we encounter this parent. Falls back to Global.
   */
  defaultRepoKey: string | null;
}

const GLOBAL_KEY = '__global__';

/**
 * Top sub-panel of the session right sidebar.
 * Hosts one Global scratchpad tab plus one tab per repo assigned to the ticket.
 * Useful for multi-repo tickets where each codebase deserves its own notes.
 */
export function SidebarTopPanel({ parentSessionId, repoKeys, defaultRepoKey }: Props) {
  const tabs = useMemo<ScratchpadTab[]>(() => {
    const repoTabs = repoKeys.map((key) => ({ key, label: key.split('/').pop() || key }));
    return [{ key: GLOBAL_KEY, label: 'Global' }, ...repoTabs];
  }, [repoKeys]);

  const persistedActive = useSidebarTerminalsStore((s) => s.activeTopTabByParent[parentSessionId]);
  const setActiveTopTab = useSidebarTerminalsStore((s) => s.setActiveTopTab);
  const toggleRightSidebar = useUIStore((s) => s.toggleRightSidebar);

  // Resolve the effective active tab: persisted (if still valid) > defaultRepoKey > Global.
  const activeKey = useMemo(() => {
    if (persistedActive && tabs.some((t) => t.key === persistedActive)) return persistedActive;
    if (defaultRepoKey && tabs.some((t) => t.key === defaultRepoKey)) return defaultRepoKey;
    return GLOBAL_KEY;
  }, [persistedActive, defaultRepoKey, tabs]);

  // Persist the resolved active tab the first time we mount for a parent, so
  // subsequent reads stay stable even if defaultRepoKey changes.
  useEffect(() => {
    if (persistedActive !== activeKey) {
      setActiveTopTab(parentSessionId, activeKey);
    }
  }, [persistedActive, activeKey, parentSessionId, setActiveTopTab]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      <div className="flex items-center gap-0 border-b border-[var(--theme-border)] bg-[var(--theme-bg-surface)] h-8 flex-shrink-0">
        <div className="flex items-center flex-1 min-w-0 overflow-x-auto px-2">
          {tabs.map((tab) => {
            const isActive = tab.key === activeKey;
            return (
              <div
                key={tab.key}
                role="button"
                onClick={() => setActiveTopTab(parentSessionId, tab.key)}
                title={tab.key === GLOBAL_KEY ? 'Global scratchpad' : tab.key}
                className={`relative flex items-center gap-1.5 px-3 py-2 text-xs whitespace-nowrap cursor-pointer transition-colors ${
                  isActive
                    ? 'text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
                }`}
              >
                <span className="truncate max-w-[120px]">{tab.label}</span>
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-[var(--theme-accent)]" />
                )}
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={toggleRightSidebar}
          title="Collapse sidebar"
          className="flex h-full items-center justify-center px-2 text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)] transition-colors flex-shrink-0 border-l border-[var(--theme-border)]"
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
            <line x1="10" y1="1.5" x2="10" y2="14.5" />
          </svg>
        </button>
      </div>
      {/* Remount on key change so the textarea reloads the correct entry without
          carrying autosave debounce state between scratchpads. */}
      <ScratchpadContent key={activeKey} storeKey={activeKey} compact />
    </div>
  );
}

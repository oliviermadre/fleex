/**
 * Notes panel for the Work view's right tool window. Hosts one Global scratchpad
 * tab plus one tab per repo attached to the ticket — the same ergonomics as the
 * session sidebar (SidebarTopPanel), so multi-repo tickets keep a set of notes
 * per codebase. The active tab is remembered per ticket in workStore.
 *
 * The scratchpad content, store keys and per-repo backend all already exist
 * (scratchpadStore + ScratchpadContent); this only assembles the tab strip.
 */
import { useEffect, useMemo } from 'react';
import { useTicketStore } from '../../../stores/ticketStore';
import { useWorkStore } from '../../../stores/workStore';
import { ScratchpadContent } from '../../scratchpad/ScratchpadContent';
import type { WorkTask } from '../types';
import { GLOBAL_KEY, scratchTabs, resolveActiveScratchTab } from './scratchTabs';

export function ScratchpadTabsPanel({ task }: { task: WorkTask }) {
  const ticket = useTicketStore((s) => s.tickets.find((t) => t.id === task.id) ?? null);
  const persistedActive = useWorkStore((s) => s.activeScratchTabByTicket[task.id]);
  const setActiveScratchTab = useWorkStore((s) => s.setActiveScratchTab);

  // Repo keys are the ticket's repository links ('org/name'), same source the
  // Context panel uses — so tabs track attach/detach live.
  const repoKeys = useMemo(
    () => (ticket?.links ?? []).filter((l) => l.type === 'repository').map((l) => l.ref),
    [ticket],
  );

  const tabs = useMemo(() => scratchTabs(repoKeys), [repoKeys]);
  const activeKey = useMemo(
    () => resolveActiveScratchTab(tabs, persistedActive),
    [tabs, persistedActive],
  );

  // Persist the resolved tab so a detached repo doesn't leave a dangling key.
  useEffect(() => {
    if (persistedActive !== activeKey) setActiveScratchTab(task.id, activeKey);
  }, [persistedActive, activeKey, task.id, setActiveScratchTab]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab strip — only meaningful when the ticket has repos; Global always shows. */}
      {tabs.length > 1 && (
        <div className="flex h-8 shrink-0 items-center gap-0 overflow-x-auto border-b border-[var(--theme-border)] px-2">
          {tabs.map((tab) => {
            const isActive = tab.key === activeKey;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveScratchTab(task.id, tab.key)}
                title={tab.key === GLOBAL_KEY ? 'Global scratchpad' : tab.key}
                className={`relative flex items-center whitespace-nowrap px-3 py-2 text-xs transition-colors ${
                  isActive
                    ? 'text-[var(--theme-text-primary)]'
                    : 'text-[var(--theme-text-muted)] hover:text-[var(--theme-text-secondary)] hover:bg-[var(--theme-bg-hover)]'
                }`}
              >
                <span className="max-w-[120px] truncate">{tab.label}</span>
                {isActive && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--theme-accent)]" />
                )}
              </button>
            );
          })}
        </div>
      )}
      {/* Remount on key change so the textarea reloads the right entry without
          carrying autosave debounce state between scratchpads. */}
      <ScratchpadContent key={activeKey} storeKey={activeKey} compact />
    </div>
  );
}

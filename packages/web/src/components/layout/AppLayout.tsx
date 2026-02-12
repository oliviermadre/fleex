import { useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useSessions } from '../../hooks/useSessions';
import { useRepositoryDashboard } from '../../hooks/useRepositoryDashboard';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useHotkeyReveal } from '../../hooks/useHotkeyReveal';
import { usePullRequestPolling } from '../../hooks/usePullRequestPolling';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { NavSidebar } from '../sidebar/NavSidebar';
import { ContentPanel } from '../sidebar/ContentPanel';
import { MainPanel } from '../main-panel/MainPanel';
import { ResizeHandle } from './ResizeHandle';
import { ScratchpadPanel } from '../scratchpad/ScratchpadPanel';
import { ScratchpadHint } from '../scratchpad/ScratchpadHint';

const NAV_COLLAPSED_WIDTH = 48;
const NAV_EXPANDED_WIDTH = 180;

export function AppLayout() {
  useWebSocket();
  useSessions();
  useRepositoryDashboard();
  useKeyboardShortcuts();
  useHotkeyReveal();
  usePullRequestPolling();

  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const activePanel = useUIStore((s) => s.activePanel);
  const contentPanelWidth = useUIStore((s) => s.contentPanelWidth);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : NAV_EXPANDED_WIDTH;
  const hideContentPanel = activePanel === 'cluster';
  const effectiveContentWidth = hideContentPanel ? 0 : contentPanelWidth;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[var(--theme-bg-base)]"
      style={{
        display: 'grid',
        gridTemplateColumns: `${navWidth}px ${effectiveContentWidth}px 1fr`,
        transition: 'grid-template-columns 150ms ease',
      }}
    >
      <div className="overflow-hidden">
        <NavSidebar />
      </div>
      <div className="overflow-hidden">
        <ContentPanel />
      </div>
      <div className="relative flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        {!hideContentPanel && <ResizeHandle />}
        <MainPanel />
      </div>
      <ScratchpadPanel />
      <ScratchpadHint />
    </div>
  );
}

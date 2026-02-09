import { useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useSessions } from '../../hooks/useSessions';
import { useRepositoryDashboard } from '../../hooks/useRepositoryDashboard';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { NavSidebar } from '../sidebar/NavSidebar';
import { ContentPanel } from '../sidebar/ContentPanel';
import { MainPanel } from '../main-panel/MainPanel';
import { ResizeHandle } from './ResizeHandle';

const NAV_COLLAPSED_WIDTH = 48;
const NAV_EXPANDED_WIDTH = 180;

export function AppLayout() {
  useWebSocket();
  useSessions();
  useRepositoryDashboard();
  useKeyboardShortcuts();

  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const contentPanelWidth = useUIStore((s) => s.contentPanelWidth);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : NAV_EXPANDED_WIDTH;

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-[var(--theme-bg-base)]"
      style={{
        display: 'grid',
        gridTemplateColumns: `${navWidth}px ${contentPanelWidth}px 1fr`,
        transition: 'grid-template-columns 150ms ease',
      }}
    >
      <div className="overflow-hidden">
        <NavSidebar />
      </div>
      <div className="overflow-hidden">
        <ContentPanel />
      </div>
      <div className="relative flex overflow-hidden" style={{ minWidth: 0 }}>
        <ResizeHandle />
        <MainPanel />
      </div>
    </div>
  );
}

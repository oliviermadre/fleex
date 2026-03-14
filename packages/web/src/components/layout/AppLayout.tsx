import { useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useSessions } from '../../hooks/useSessions';
import { useRepositoryDashboard } from '../../hooks/useRepositoryDashboard';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useHotkeyReveal } from '../../hooks/useHotkeyReveal';
import { useTickets } from '../../hooks/useTickets';
import { useAgentPersonas } from '../../hooks/useAgentPersonas';
import { useSkills } from '../../hooks/useSkills';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { NavSidebar } from '../sidebar/NavSidebar';
import { ContentPanel } from '../sidebar/ContentPanel';
import { MainPanel } from '../main-panel/MainPanel';
import { ResizeHandle } from './ResizeHandle';
import { ScratchpadPanel } from '../scratchpad/ScratchpadPanel';
import { ScratchpadHint } from '../scratchpad/ScratchpadHint';
import { FloatingSessionOverlay } from '../main-panel/FloatingSessionOverlay';

const NAV_COLLAPSED_WIDTH = 55;
const NAV_EXPANDED_WIDTH = 200;
const CONTENT_PANEL_COLLAPSED_WIDTH = 55;

export function AppLayout() {
  useWebSocket();
  useSessions();
  useRepositoryDashboard();
  useKeyboardShortcuts();
  useHotkeyReveal();
  useTickets();
  useAgentPersonas();
  useSkills();

  const navCollapsed = useUIStore((s) => s.navCollapsed);
  const activePanel = useUIStore((s) => s.activePanel);
  const contentPanelWidth = useUIStore((s) => s.contentPanelWidth);
  const contentPanelCollapsed = useUIStore((s) => s.contentPanelCollapsed);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const navWidth = navCollapsed ? NAV_COLLAPSED_WIDTH : NAV_EXPANDED_WIDTH;
  const hideContentPanel = activePanel === 'dashboard' || activePanel === 'cluster' || activePanel === 'tickets';
  const effectiveContentWidth = hideContentPanel
    ? 0
    : contentPanelCollapsed
      ? CONTENT_PANEL_COLLAPSED_WIDTH
      : contentPanelWidth;

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
      <div className={contentPanelCollapsed ? 'overflow-visible' : 'overflow-hidden'}>
        <ContentPanel />
      </div>
      <div className="relative flex flex-1 overflow-hidden" style={{ minWidth: 0 }}>
        {!hideContentPanel && <ResizeHandle />}
        <MainPanel />
      </div>
      <ScratchpadPanel />
      <ScratchpadHint />
      <FloatingSessionOverlay />
    </div>
  );
}

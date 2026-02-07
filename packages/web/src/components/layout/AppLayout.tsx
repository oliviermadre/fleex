import { useEffect } from 'react';
import { useWebSocket } from '../../hooks/useWebSocket';
import { useSessions } from '../../hooks/useSessions';
import { useKeyboardShortcuts } from '../../hooks/useKeyboardShortcuts';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { Sidebar } from '../sidebar/Sidebar';
import { MainPanel } from '../main-panel/MainPanel';
import { ResizeHandle } from './ResizeHandle';

const COLLAPSED_WIDTH = 48;

export function AppLayout() {
  useWebSocket();
  useSessions();
  useKeyboardShortcuts();

  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const sidebarWidth = useUIStore((s) => s.sidebarWidth);
  const loadSettings = useSettingsStore((s) => s.loadSettings);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  return (
    <div
      className="flex h-screen w-screen overflow-hidden bg-zinc-950"
      style={{
        display: 'grid',
        gridTemplateColumns: sidebarCollapsed
          ? `${COLLAPSED_WIDTH}px 1fr`
          : `${sidebarWidth}px 1fr`,
        transition: 'grid-template-columns 150ms ease',
      }}
    >
      <div className="overflow-hidden">
        <Sidebar />
      </div>
      <div className="relative flex" style={{ minWidth: 0 }}>
        {!sidebarCollapsed && <ResizeHandle />}
        <MainPanel />
      </div>
    </div>
  );
}

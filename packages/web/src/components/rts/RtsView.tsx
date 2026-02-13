import { useRef, useState, useCallback, useEffect } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useRtsMapLayout } from './useRtsMapLayout';
import { ResourceBar } from './ResourceBar';
import { MapViewport } from './MapViewport';
import { Minimap } from './Minimap';
import { SelectedPanel } from './SelectedPanel';
import { CommandCard } from './CommandCard';
import { RtsTerminalOverlay } from './RtsTerminalOverlay';
import type { RtsSelection } from '../../stores/uiStore';

export function RtsView() {
  const sessions = useSessionStore((s) => s.sessions);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const pullsByRepo = usePullRequestStore((s) => s.pullsByRepo);
  const rtsSelection = useUIStore((s) => s.rtsSelection);
  const setRtsSelection = useUIStore((s) => s.setRtsSelection);
  const displayNames = useSettingsStore((s) => s.settings.sessionDisplayNames);

  const mapModel = useRtsMapLayout(sessionGroups);

  // Floating terminal overlay state
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const focusedSession = focusedSessionId
    ? sessions.find((s) => s.id === focusedSessionId) ?? null
    : null;

  // Unit position overrides (right-click movement)
  const [unitOverrides, setUnitOverrides] = useState<Record<string, { x: number; y: number }>>({});

  // Viewport tracking for minimap
  const viewportStateRef = useRef<{ offset: { x: number; y: number }; zoom: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const mapContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Minimap navigation
  const handleMinimapNavigate = useCallback((mapX: number, mapY: number) => {
    const el = mapContainerRef.current;
    if (!el) return;
    const viewport = el.querySelector('.rts-map-terrain') as HTMLDivElement & { navigateTo?: (x: number, y: number) => void };
    if (viewport?.navigateTo) {
      viewport.navigateTo(mapX, mapY);
    }
  }, []);

  const handleSelect = useCallback((selection: RtsSelection) => {
    setRtsSelection(selection);
  }, [setRtsSelection]);

  const handleFocusSession = useCallback((sessionId: string) => {
    setFocusedSessionId(sessionId);
  }, []);

  const handleCloseTerminal = useCallback(() => {
    setFocusedSessionId(null);
  }, []);

  const handleMoveUnit = useCallback((sessionId: string, x: number, y: number) => {
    setUnitOverrides((prev) => ({ ...prev, [sessionId]: { x, y } }));
  }, []);

  return (
    <div
      className="rts-view flex flex-1 flex-col overflow-hidden"
      style={{ background: '#0a0514' }}
    >
      {/* Top: Resource Bar */}
      <ResourceBar sessions={sessions} bases={mapModel.bases} />

      {/* Center: Map Viewport */}
      <div ref={mapContainerRef} className="relative flex-1 overflow-hidden">
        <MapViewport
          mapModel={mapModel}
          rtsSelection={rtsSelection}
          pullsByRepo={pullsByRepo}
          displayNames={displayNames}
          unitOverrides={unitOverrides}
          onSelect={handleSelect}
          onFocusSession={handleFocusSession}
          onMoveUnit={handleMoveUnit}
          viewportRef={viewportStateRef}
        />
      </div>

      {/* Bottom: Minimap | SelectedPanel | CommandCard */}
      <div
        className="flex"
        style={{
          height: 180,
          borderTop: `1px solid ${ZERG_BORDER}`,
          background: 'rgba(10, 5, 20, 0.95)',
        }}
      >
        {/* Minimap */}
        <div className="flex items-center justify-center p-2">
          <Minimap
            mapModel={mapModel}
            viewport={viewportStateRef.current}
            containerSize={containerSize}
            onNavigate={handleMinimapNavigate}
          />
        </div>

        {/* Selected Panel */}
        <div
          className="flex flex-1 items-stretch overflow-hidden"
          style={{
            borderLeft: `1px solid ${ZERG_BORDER}`,
            borderRight: `1px solid ${ZERG_BORDER}`,
          }}
        >
          <SelectedPanel
            rtsSelection={rtsSelection}
            sessions={sessions}
            mapModel={mapModel}
            pullsByRepo={pullsByRepo}
            summaries={summaries}
            displayNames={displayNames}
          />
        </div>

        {/* Command Card */}
        <div className="flex items-center justify-center p-2">
          <CommandCard
            rtsSelection={rtsSelection}
            sessions={sessions}
            mapModel={mapModel}
            onFocusSession={handleFocusSession}
          />
        </div>
      </div>

      {/* Floating terminal overlay */}
      {focusedSession && (
        <RtsTerminalOverlay
          session={focusedSession}
          onClose={handleCloseTerminal}
        />
      )}
    </div>
  );
}

const ZERG_BORDER = '#3a1a55';

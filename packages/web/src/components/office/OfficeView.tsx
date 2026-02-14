import { useRef, useState, useCallback, useEffect } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import { useRepositoryDashboardStore } from '../../stores/repositoryDashboardStore';
import { usePullRequestStore } from '../../stores/pullRequestStore';
import { useUIStore } from '../../stores/uiStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { useOfficeLayout } from './useOfficeLayout';
import { useOfficeActions, getHotkeyMap } from './useOfficeActions';
import { OfficeResourceBar } from './OfficeResourceBar';
import { OfficeViewport } from './OfficeViewport';
import type { OfficeViewportHandle } from './OfficeViewport';
import { OfficeMinimap } from './OfficeMinimap';
import { OfficeSelectedPanel } from './OfficeSelectedPanel';
import { OfficeCommandCard } from './OfficeCommandCard';
import { OfficeTerminalOverlay } from './OfficeTerminalOverlay';
import { OfficeToolbar } from './OfficeToolbar';
import { OfficeEmptyState } from './OfficeEmptyState';
import { OfficeContextMenu, buildContextMenuItems } from './OfficeContextMenu';
import type { ContextMenuTarget } from './OfficeContextMenu';
import { OfficeToastStack } from './OfficeToast';
import type { ToastItem } from './OfficeToast';
import { OfficeDataOverlay } from './OfficeDataOverlay';
import type { OfficeSelection, MapObject, DataOverlayTarget } from './types';
import { OFFICE } from './officeTheme';

let toastIdCounter = 0;

export function OfficeView() {
  const sessions = useSessionStore((s) => s.sessions);
  const sessionGroups = useSessionStore((s) => s.sessionGroups);
  const summaries = useRepositoryDashboardStore((s) => s.summaries);
  const pullsByRepo = usePullRequestStore((s) => s.pullsByRepo);
  const officeSelection = useUIStore((s) => s.officeSelection);
  const setOfficeSelection = useUIStore((s) => s.setOfficeSelection);
  const openCreateModal = useUIStore((s) => s.openCreateModal);
  const displayNames = useSettingsStore((s) => s.settings.sessionDisplayNames);
  const resolvedRepositories = useSettingsStore((s) => s.settings.resolvedRepositories);

  const mapModel = useOfficeLayout(sessionGroups, resolvedRepositories, summaries);

  // Floating terminal overlay
  const [focusedSessionId, setFocusedSessionId] = useState<string | null>(null);
  const focusedSession = focusedSessionId
    ? sessions.find((s) => s.id === focusedSessionId) ?? null
    : null;

  // Data overlay (bookshelf, delivery, work pile)
  const [dataOverlay, setDataOverlay] = useState<DataOverlayTarget>(null);
  const handleCloseDataOverlay = useCallback(() => setDataOverlay(null), []);

  // Viewport tracking for minimap
  const viewportStateRef = useRef<{ offset: { x: number; y: number }; zoom: number } | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const viewportHandleRef = useRef<OfficeViewportHandle>(null);

  // Zoom state for toolbar display
  const [currentZoom, setCurrentZoom] = useState(1.0);

  // Toast state
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const addToast = useCallback((message: string) => {
    const id = ++toastIdCounter;
    setToasts((prev) => [...prev, { id, message }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);

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
    const viewport = el.querySelector('.office-map-terrain') as HTMLDivElement & { navigateTo?: (x: number, y: number) => void };
    if (viewport?.navigateTo) {
      viewport.navigateTo(mapX, mapY);
    }
  }, []);

  // Handle selection — map room selections to repo/lobby, pass rest through directly
  const handleSelect = useCallback((selection: OfficeSelection) => {
    if (!selection) {
      setOfficeSelection(null);
      return;
    }
    if (selection.type === 'room') {
      const room = mapModel.rooms.find((r) => r.id === selection.roomId);
      if (room?.repoKey) {
        setOfficeSelection({ type: 'repo', repoKey: room.repoKey });
      } else {
        setOfficeSelection({ type: 'lobby' });
      }
      return;
    }
    setOfficeSelection(selection);
  }, [setOfficeSelection, mapModel.rooms]);

  const handleFocusSession = useCallback((sessionId: string) => {
    setFocusedSessionId(sessionId);
  }, []);

  const handleCloseTerminal = useCallback(() => {
    setFocusedSessionId(null);
  }, []);

  // Shared actions hook
  const actions = useOfficeActions({
    selection: officeSelection,
    sessions,
    mapModel,
    onFocusSession: handleFocusSession,
    onToast: addToast,
  });

  // Keyboard hotkeys
  useEffect(() => {
    if (focusedSessionId) return; // Don't handle hotkeys when terminal is open

    const hotkeyMap = getHotkeyMap(officeSelection, actions);

    function handleKeyDown(e: KeyboardEvent) {
      // Skip if user is typing in an input
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      // Skip modifier combos
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const handler = hotkeyMap[e.key.toLowerCase()];
      if (handler) {
        e.preventDefault();
        handler();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [officeSelection, actions, focusedSessionId]);

  // Context menu handler from objects
  const handleObjectContextMenu = useCallback((e: React.MouseEvent, object: MapObject) => {
    // Select the object first
    if (object.binding?.type === 'session') {
      setOfficeSelection({ type: 'session', sessionId: object.binding.sessionId });
    } else if (object.binding?.type === 'worktree') {
      setOfficeSelection({ type: 'worktree', repoKey: object.binding.repoKey, branch: object.binding.branch });
    } else if (object.binding?.type === 'repo') {
      setOfficeSelection({ type: 'repo', repoKey: object.binding.repoKey });
    } else if (object.binding?.type === 'repo-prs' || object.binding?.type === 'repo-merged' || object.binding?.type === 'repo-assigned') {
      setOfficeSelection({ type: 'repo', repoKey: object.binding.repoKey });
    }
    setContextMenu({ x: e.clientX, y: e.clientY, object });
  }, [setOfficeSelection]);

  const handleCloseContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // Zoom toolbar callbacks
  const handleZoomIn = useCallback(() => viewportHandleRef.current?.zoomIn(), []);
  const handleZoomOut = useCallback(() => viewportHandleRef.current?.zoomOut(), []);
  const handleResetView = useCallback(() => viewportHandleRef.current?.resetView(), []);

  // Empty state — no sessions, no repo groups, and no followed repos
  const isEmpty = sessions.length === 0 && sessionGroups.length === 0 && resolvedRepositories.length === 0;

  // Context menu items (needs actions to be computed after selection is set)
  const contextMenuItems = contextMenu
    ? buildContextMenuItems(contextMenu.object, {
        ...actions,
        openPRLibrary: contextMenu.object.binding?.type === 'repo-prs'
          ? () => setDataOverlay({ type: 'pr-library', repoKey: contextMenu.object.binding!.type === 'repo-prs' ? (contextMenu.object.binding as { type: 'repo-prs'; repoKey: string }).repoKey : '' })
          : undefined,
        openMergedPRs: contextMenu.object.binding?.type === 'repo-merged'
          ? () => setDataOverlay({ type: 'merged', repoKey: (contextMenu.object.binding as { type: 'repo-merged'; repoKey: string }).repoKey })
          : undefined,
        openAssignedWork: contextMenu.object.binding?.type === 'repo-assigned'
          ? () => setDataOverlay({ type: 'assigned', repoKey: (contextMenu.object.binding as { type: 'repo-assigned'; repoKey: string }).repoKey })
          : undefined,
      })
    : [];

  return (
    <div
      className="office-view flex flex-1 flex-col overflow-hidden"
      style={{ background: OFFICE.exteriorDark }}
    >
      {/* Top: Resource Bar */}
      <OfficeResourceBar sessions={sessions} mapModel={mapModel} />

      {/* Center: Map Viewport */}
      <div ref={mapContainerRef} className="relative flex-1 overflow-hidden">
        <OfficeViewport
          ref={viewportHandleRef}
          mapModel={mapModel}
          selection={officeSelection}
          sessions={sessions}
          displayNames={displayNames}
          onSelect={handleSelect}
          onFocusSession={handleFocusSession}
          onContextMenu={handleObjectContextMenu}
          onOpenDataOverlay={setDataOverlay}
          viewportRef={viewportStateRef}
          onZoomChange={setCurrentZoom}
        />

        {/* Zoom Toolbar */}
        <OfficeToolbar
          zoom={currentZoom}
          onZoomIn={handleZoomIn}
          onZoomOut={handleZoomOut}
          onResetView={handleResetView}
        />

        {/* Empty state overlay */}
        {isEmpty && <OfficeEmptyState onCreateSession={openCreateModal} />}
      </div>

      {/* Bottom: Minimap | SelectedPanel | CommandCard */}
      <div
        className="flex"
        style={{
          height: 180,
          borderTop: `1px solid ${OFFICE.panelBorderDim}`,
          background: OFFICE.panelBg,
        }}
      >
        {/* Minimap */}
        <div className="flex items-center justify-center p-2">
          <OfficeMinimap
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
            borderLeft: `1px solid ${OFFICE.panelBorderDim}`,
            borderRight: `1px solid ${OFFICE.panelBorderDim}`,
          }}
        >
          <OfficeSelectedPanel
            selection={officeSelection}
            sessions={sessions}
            mapModel={mapModel}
            pullsByRepo={pullsByRepo}
            summaries={summaries}
            displayNames={displayNames}
          />
        </div>

        {/* Command Card */}
        <div className="flex items-center justify-center p-2">
          <OfficeCommandCard
            selection={officeSelection}
            sessions={sessions}
            mapModel={mapModel}
            onFocusSession={handleFocusSession}
            onToast={addToast}
          />
        </div>
      </div>

      {/* Floating terminal overlay */}
      {focusedSession && (
        <OfficeTerminalOverlay
          session={focusedSession}
          onClose={handleCloseTerminal}
        />
      )}

      {/* Data overlay (bookshelf / delivery / work pile) */}
      {dataOverlay && (
        <OfficeDataOverlay
          target={dataOverlay}
          onClose={handleCloseDataOverlay}
        />
      )}

      {/* Context menu */}
      {contextMenu && contextMenuItems.length > 0 && (
        <OfficeContextMenu
          target={contextMenu}
          items={contextMenuItems}
          onClose={handleCloseContextMenu}
        />
      )}

      {/* Toast notifications */}
      <OfficeToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}

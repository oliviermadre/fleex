import { memo, useRef, useState, useCallback, useEffect } from 'react';
import type { PullRequest } from '@asm/shared';
import type { RtsMapModel } from './useRtsMapLayout';
import type { RtsSelection } from '../../stores/uiStore';
import { BaseCluster } from './BaseCluster';
import { NydusNetwork } from './NydusNetwork';

interface MapViewportProps {
  mapModel: RtsMapModel;
  rtsSelection: RtsSelection;
  pullsByRepo: Record<string, Record<string, PullRequest>>;
  displayNames: Record<string, string>;
  unitOverrides: Record<string, { x: number; y: number }>;
  onSelect: (selection: RtsSelection) => void;
  onFocusSession: (sessionId: string) => void;
  onMoveUnit: (sessionId: string, x: number, y: number) => void;
  viewportRef: React.RefObject<{ offset: { x: number; y: number }; zoom: number } | null>;
}

export const MapViewport = memo(function MapViewport({
  mapModel,
  rtsSelection,
  pullsByRepo,
  displayNames,
  unitOverrides,
  onSelect,
  onFocusSession,
  onMoveUnit,
  viewportRef,
}: MapViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(0.85);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const hasCentered = useRef(false);

  // Compute minimum zoom so map always fills viewport
  const getMinZoom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 0.3;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return 0.3;
    return Math.max(
      rect.width / mapModel.mapWidth,
      rect.height / mapModel.mapHeight,
    );
  }, [mapModel.mapWidth, mapModel.mapHeight]);

  // Clamp offset so the map edges never leave the viewport
  const clampOffset = useCallback((ox: number, oy: number, z: number) => {
    const container = containerRef.current;
    if (!container) return { x: ox, y: oy };
    const rect = container.getBoundingClientRect();
    const scaledW = mapModel.mapWidth * z;
    const scaledH = mapModel.mapHeight * z;

    // offset can be at most 0 (left/top edge at viewport edge)
    // offset must be at least (viewportSize - scaledMapSize) so right/bottom edge stays in
    const minX = rect.width - scaledW;
    const minY = rect.height - scaledH;

    return {
      x: Math.min(0, Math.max(minX, ox)),
      y: Math.min(0, Math.max(minY, oy)),
    };
  }, [mapModel.mapWidth, mapModel.mapHeight]);

  // Auto-center on content when first mounted or when bases appear
  useEffect(() => {
    if (hasCentered.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const minZoom = getMinZoom();
    const z = Math.max(zoom, minZoom);

    // Find the center of all content
    const allPositions = [
      ...mapModel.bases.map((b) => b.position),
      ...(mapModel.nydus ? [mapModel.nydus.position] : []),
    ];
    if (allPositions.length === 0) {
      const centered = clampOffset(
        rect.width / 2 - (mapModel.mapWidth / 2) * z,
        rect.height / 2 - (mapModel.mapHeight / 2) * z,
        z,
      );
      setOffset(centered);
      setZoom(z);
      hasCentered.current = true;
      return;
    }

    const avgX = allPositions.reduce((s, p) => s + p.x, 0) / allPositions.length;
    const avgY = allPositions.reduce((s, p) => s + p.y, 0) / allPositions.length;

    const centered = clampOffset(
      rect.width / 2 - avgX * z,
      rect.height / 2 - avgY * z,
      z,
    );
    setOffset(centered);
    setZoom(z);
    hasCentered.current = true;
  }, [mapModel.bases, mapModel.nydus, zoom, getMinZoom, clampOffset, mapModel.mapWidth, mapModel.mapHeight]);

  // Expose viewport state to parent
  useEffect(() => {
    if (viewportRef.current !== undefined && offset) {
      (viewportRef as React.MutableRefObject<{ offset: { x: number; y: number }; zoom: number } | null>).current = { offset, zoom };
    }
  }, [offset, zoom, viewportRef]);

  const effectiveOffset = offset ?? { x: 0, y: 0 };

  // --- Edge scrolling ---
  const EDGE_ZONE = 40;
  const SCROLL_SPEED = 8;
  const edgeScrollDir = useRef({ x: 0, y: 0 });
  const edgeScrollRaf = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      const { x: dx, y: dy } = edgeScrollDir.current;
      if (dx !== 0 || dy !== 0) {
        setOffset((prev) => {
          if (!prev) return prev;
          return clampOffset(prev.x + dx, prev.y + dy, zoom);
        });
      }
      edgeScrollRaf.current = requestAnimationFrame(tick);
    };
    edgeScrollRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(edgeScrollRaf.current);
  }, [zoom, clampOffset]);

  const handleEdgeScroll = useCallback((e: React.MouseEvent) => {
    if (dragging) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    let dx = 0;
    let dy = 0;
    if (mx < EDGE_ZONE) dx = SCROLL_SPEED;
    else if (mx > rect.width - EDGE_ZONE) dx = -SCROLL_SPEED;
    if (my < EDGE_ZONE) dy = SCROLL_SPEED;
    else if (my > rect.height - EDGE_ZONE) dy = -SCROLL_SPEED;

    edgeScrollDir.current = { x: dx, y: dy };
  }, [dragging]);

  const handleEdgeScrollStop = useCallback(() => {
    edgeScrollDir.current = { x: 0, y: 0 };
  }, []);

  // --- Keyboard arrow scrolling ---
  const keysPressed = useRef(new Set<string>());
  const keyScrollRaf = useRef<number>(0);
  const KEY_SCROLL_SPEED = 10;

  useEffect(() => {
    const tick = () => {
      const keys = keysPressed.current;
      let dx = 0;
      let dy = 0;
      if (keys.has('ArrowLeft')) dx += KEY_SCROLL_SPEED;
      if (keys.has('ArrowRight')) dx -= KEY_SCROLL_SPEED;
      if (keys.has('ArrowUp')) dy += KEY_SCROLL_SPEED;
      if (keys.has('ArrowDown')) dy -= KEY_SCROLL_SPEED;

      if (dx !== 0 || dy !== 0) {
        setOffset((prev) => {
          if (!prev) return prev;
          return clampOffset(prev.x + dx, prev.y + dy, zoom);
        });
      }
      keyScrollRaf.current = requestAnimationFrame(tick);
    };
    keyScrollRaf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(keyScrollRaf.current);
  }, [zoom, clampOffset]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        keysPressed.current.add(e.key);
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, offsetX: effectiveOffset.x, offsetY: effectiveOffset.y };
  }, [effectiveOffset]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (dragging) {
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setOffset(clampOffset(dragStart.current.offsetX + dx, dragStart.current.offsetY + dy, zoom));
    }
    // Edge scroll detection runs even when not dragging
    handleEdgeScroll(e);
  }, [dragging, zoom, clampOffset, handleEdgeScroll]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const minZoom = getMinZoom();
    setZoom((prevZoom) => {
      const newZoom = Math.max(minZoom, Math.min(2.0, prevZoom - e.deltaY * 0.001));
      // Re-clamp offset for the new zoom level
      setOffset((prev) => {
        if (!prev) return prev;
        return clampOffset(prev.x, prev.y, newZoom);
      });
      return newZoom;
    });
  }, [getMinZoom, clampOffset]);

  // Click on empty map deselects
  const handleMapClick = useCallback(() => {
    onSelect(null);
  }, [onSelect]);

  // Right-click on map: move selected unit to clicked position
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!rtsSelection || rtsSelection.type !== 'session') return;

    const mapX = (e.clientX - containerRef.current!.getBoundingClientRect().left - effectiveOffset.x) / zoom;
    const mapY = (e.clientY - containerRef.current!.getBoundingClientRect().top - effectiveOffset.y) / zoom;

    onMoveUnit(rtsSelection.sessionId, mapX, mapY);
  }, [rtsSelection, effectiveOffset, zoom, onMoveUnit]);

  // Navigate viewport to position (used by minimap)
  const navigateTo = useCallback((x: number, y: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setOffset(clampOffset(
      rect.width / 2 - x * zoom,
      rect.height / 2 - y * zoom,
      zoom,
    ));
  }, [zoom, clampOffset]);

  // Expose navigateTo on the container element for minimap access
  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      (el as HTMLDivElement & { navigateTo?: typeof navigateTo }).navigateTo = navigateTo;
    }
  }, [navigateTo]);

  return (
    <div
      ref={containerRef}
      className="rts-map-terrain absolute inset-0 overflow-hidden"
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { handleMouseUp(); handleEdgeScrollStop(); }}
      onWheel={handleWheel}
      onContextMenu={handleContextMenu}
    >
      <div
        className="rts-map-world"
        style={{
          position: 'absolute',
          width: mapModel.mapWidth,
          height: mapModel.mapHeight,
          transform: `translate(${effectiveOffset.x}px, ${effectiveOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
        }}
        onClick={handleMapClick}
      >
        {/* Base clusters */}
        {mapModel.bases.map((base) => {
          const repoUnits = mapModel.units.filter(
            (u) =>
              u.parentType === 'worktree' &&
              (u.session.repositoryOrg + '/' + u.session.repositoryName) === base.repoKey
          );

          return (
            <BaseCluster
              key={base.repoKey}
              base={base}
              rtsSelection={rtsSelection}
              pullsByBranch={pullsByRepo[base.repoKey] ?? {}}
              displayNames={displayNames}
              units={repoUnits.map((u) => ({ session: u.session, position: u.position }))}
              unitOverrides={unitOverrides}
              onSelect={onSelect}
              onFocusSession={onFocusSession}
            />
          );
        })}

        {/* Nydus Network */}
        {mapModel.nydus && (
          <NydusNetwork
            nydus={mapModel.nydus}
            rtsSelection={rtsSelection}
            displayNames={displayNames}
            units={mapModel.units
              .filter((u) => u.parentType === 'nydus')
              .map((u) => ({ session: u.session, position: u.position }))}
            unitOverrides={unitOverrides}
            onSelect={onSelect}
            onFocusSession={onFocusSession}
          />
        )}
      </div>
    </div>
  );
});

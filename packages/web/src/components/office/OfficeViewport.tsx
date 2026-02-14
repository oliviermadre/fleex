import { memo, useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import type { OfficeMapModel, OfficeSelection, MapObject, DataOverlayTarget } from './types';
import type { Session } from '@asm/shared';
import { TileCanvas } from './TileCanvas';
import { ObjectLayer } from './ObjectLayer';
import { RoomLabels } from './RoomLabels';

/** Pixel-art-friendly zoom levels */
export const ZOOM_LEVELS = [0.5, 0.75, 1.0, 1.5, 2.0, 3.0];

function snapToZoomLevel(target: number): number {
  let closest = ZOOM_LEVELS[0]!;
  let minDist = Math.abs(target - closest);
  for (const level of ZOOM_LEVELS) {
    const dist = Math.abs(target - level);
    if (dist < minDist) {
      closest = level;
      minDist = dist;
    }
  }
  return closest;
}

export interface OfficeViewportHandle {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  getZoom: () => number;
}

interface OfficeViewportProps {
  mapModel: OfficeMapModel;
  selection: OfficeSelection;
  sessions: Session[];
  displayNames: Record<string, string>;
  onSelect: (selection: OfficeSelection) => void;
  onFocusSession: (sessionId: string) => void;
  onContextMenu?: (e: React.MouseEvent, object: MapObject) => void;
  onOpenDataOverlay?: (target: DataOverlayTarget) => void;
  viewportRef: React.RefObject<{ offset: { x: number; y: number }; zoom: number } | null>;
  onZoomChange?: (zoom: number) => void;
}

export const OfficeViewport = memo(forwardRef<OfficeViewportHandle, OfficeViewportProps>(function OfficeViewport({
  mapModel,
  selection,
  sessions,
  displayNames,
  onSelect,
  onFocusSession,
  onContextMenu,
  onOpenDataOverlay,
  viewportRef,
  onZoomChange,
}, ref) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1.0);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, offsetX: 0, offsetY: 0 });
  const hasCentered = useRef(false);

  // Refs for synchronous reads in wheel handler (avoids nested updater issues)
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const offsetRef = useRef(offset ?? { x: 0, y: 0 });
  if (offset) offsetRef.current = offset;

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

  // Clamp offset so map edges never leave viewport; center when map fits
  const clampOffset = useCallback((ox: number, oy: number, z: number) => {
    const container = containerRef.current;
    if (!container) return { x: ox, y: oy };
    const rect = container.getBoundingClientRect();
    const scaledW = mapModel.mapWidth * z;
    const scaledH = mapModel.mapHeight * z;

    let x: number, y: number;
    if (scaledW <= rect.width) {
      x = (rect.width - scaledW) / 2;
    } else {
      x = Math.min(0, Math.max(rect.width - scaledW, ox));
    }
    if (scaledH <= rect.height) {
      y = (rect.height - scaledH) / 2;
    } else {
      y = Math.min(0, Math.max(rect.height - scaledH, oy));
    }
    return { x, y };
  }, [mapModel.mapWidth, mapModel.mapHeight]);

  // Auto-center on first mount
  useEffect(() => {
    if (hasCentered.current) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const minZoom = getMinZoom();
    const z = Math.max(zoom, minZoom);

    const centered = clampOffset(
      rect.width / 2 - (mapModel.mapWidth / 2) * z,
      rect.height / 2 - (mapModel.mapHeight / 2) * z,
      z,
    );
    setOffset(centered);
    setZoom(z);
    hasCentered.current = true;
  }, [mapModel, zoom, getMinZoom, clampOffset]);

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
    handleEdgeScroll(e);
  }, [dragging, zoom, clampOffset, handleEdgeScroll]);

  const handleMouseUp = useCallback(() => {
    setDragging(false);
  }, []);

  // Native non-passive wheel handler (React onWheel is passive, can't preventDefault)
  // Uses continuous zoom (no snapping) for smooth trackpad/mousewheel feel
  // Reads from refs to avoid nested functional updater issues
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const minZoom = getMinZoom();
      const maxZoom = ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!;

      const rect = el.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const prevZoom = zoomRef.current;
      const prevOffset = offsetRef.current;

      const factor = 1 - e.deltaY * 0.002;
      const newZoom = Math.max(minZoom, Math.min(maxZoom, prevZoom * factor));

      // Map point under cursor: mapPt = (mouse - offset) / oldZoom
      // After zoom, keep that point under cursor: newOffset = mouse - mapPt * newZoom
      const newX = mouseX - ((mouseX - prevOffset.x) / prevZoom) * newZoom;
      const newY = mouseY - ((mouseY - prevOffset.y) / prevZoom) * newZoom;
      const newOffset = clampOffset(newX, newY, newZoom);

      // Update refs synchronously so rapid events read correct values
      zoomRef.current = newZoom;
      offsetRef.current = newOffset;

      setZoom(newZoom);
      setOffset(newOffset);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [getMinZoom, clampOffset]);

  // Click on empty map deselects
  const handleMapClick = useCallback(() => {
    onSelect(null);
  }, [onSelect]);

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

  // Imperative zoom controls for toolbar
  useImperativeHandle(ref, () => ({
    zoomIn() {
      const minZoom = getMinZoom();
      setZoom((prev) => {
        const idx = ZOOM_LEVELS.indexOf(prev);
        const next = idx >= 0 && idx < ZOOM_LEVELS.length - 1
          ? ZOOM_LEVELS[idx + 1]!
          : Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1]!, prev * 1.25);
        const clamped = Math.max(minZoom, next);
        setOffset((o) => o ? clampOffset(o.x, o.y, clamped) : o);
        onZoomChange?.(clamped);
        return clamped;
      });
    },
    zoomOut() {
      const minZoom = getMinZoom();
      setZoom((prev) => {
        const idx = ZOOM_LEVELS.indexOf(prev);
        const next = idx > 0
          ? ZOOM_LEVELS[idx - 1]!
          : Math.max(minZoom, prev * 0.8);
        const clamped = Math.max(minZoom, next);
        setOffset((o) => o ? clampOffset(o.x, o.y, clamped) : o);
        onZoomChange?.(clamped);
        return clamped;
      });
    },
    resetView() {
      hasCentered.current = false;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const minZoom = getMinZoom();
      const z = Math.max(1.0, minZoom);
      const centered = clampOffset(
        rect.width / 2 - (mapModel.mapWidth / 2) * z,
        rect.height / 2 - (mapModel.mapHeight / 2) * z,
        z,
      );
      setOffset(centered);
      setZoom(z);
      onZoomChange?.(z);
    },
    getZoom() {
      return zoom;
    },
  }), [getMinZoom, clampOffset, mapModel.mapWidth, mapModel.mapHeight, zoom, onZoomChange]);

  // Notify zoom changes from wheel
  useEffect(() => {
    onZoomChange?.(zoom);
  }, [zoom, onZoomChange]);

  return (
    <div
      ref={containerRef}
      className="office-map-terrain absolute inset-0 overflow-hidden"
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => { handleMouseUp(); handleEdgeScrollStop(); }}
    >
      <div
        className="office-map-world"
        style={{
          position: 'absolute',
          width: mapModel.mapWidth,
          height: mapModel.mapHeight,
          transform: `translate(${effectiveOffset.x}px, ${effectiveOffset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          imageRendering: 'pixelated',
        }}
        onClick={handleMapClick}
      >
        {/* Canvas tile layer */}
        <TileCanvas
          layers={mapModel.layers}
          widthTiles={mapModel.mapWidthTiles}
          heightTiles={mapModel.mapHeightTiles}
        />

        {/* Room labels */}
        <RoomLabels rooms={mapModel.rooms} />

        {/* Interactive objects */}
        <ObjectLayer
          objects={mapModel.objects}
          selection={selection}
          sessions={sessions}
          displayNames={displayNames}
          onSelect={onSelect}
          onFocusSession={onFocusSession}
          onContextMenu={onContextMenu}
          onOpenDataOverlay={onOpenDataOverlay}
        />
      </div>
    </div>
  );
}));

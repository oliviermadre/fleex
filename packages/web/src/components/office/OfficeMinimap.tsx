import { memo, useCallback, useRef, useState } from 'react';
import type { OfficeMapModel } from './types';
import { TILE_PX } from './types';
import { OFFICE } from './officeTheme';

interface OfficeMinimapProps {
  mapModel: OfficeMapModel;
  viewport: { offset: { x: number; y: number }; zoom: number } | null;
  containerSize: { width: number; height: number };
  onNavigate: (mapX: number, mapY: number) => void;
}

export const OfficeMinimap = memo(function OfficeMinimap({
  mapModel,
  viewport,
  containerSize,
  onNavigate,
}: OfficeMinimapProps) {
  const minimapW = 200;
  const minimapH = 150;

  // Compute content bounding box (in pixels) from rooms
  let contentMinX = Infinity, contentMinY = Infinity;
  let contentMaxX = -Infinity, contentMaxY = -Infinity;
  for (const room of mapModel.rooms) {
    const rx = room.tileX * TILE_PX;
    const ry = room.tileY * TILE_PX;
    const rw = room.tileW * TILE_PX;
    const rh = room.tileH * TILE_PX;
    contentMinX = Math.min(contentMinX, rx);
    contentMinY = Math.min(contentMinY, ry);
    contentMaxX = Math.max(contentMaxX, rx + rw);
    contentMaxY = Math.max(contentMaxY, ry + rh);
  }
  // Fallback if no rooms
  if (!isFinite(contentMinX)) {
    contentMinX = 0; contentMinY = 0;
    contentMaxX = mapModel.mapWidth; contentMaxY = mapModel.mapHeight;
  }

  // Add padding around content
  const pad = 2 * TILE_PX;
  contentMinX = Math.max(0, contentMinX - pad);
  contentMinY = Math.max(0, contentMinY - pad);
  contentMaxX = Math.min(mapModel.mapWidth, contentMaxX + pad);
  contentMaxY = Math.min(mapModel.mapHeight, contentMaxY + pad);

  const contentW = contentMaxX - contentMinX;
  const contentH = contentMaxY - contentMinY;

  // Scale to fit content bounding box in minimap
  const scaleX = minimapW / Math.max(contentW, 1);
  const scaleY = minimapH / Math.max(contentH, 1);
  const scale = Math.min(scaleX, scaleY);

  // Offset to center content in minimap
  const renderedW = contentW * scale;
  const renderedH = contentH * scale;
  const offsetX = (minimapW - renderedW) / 2;
  const offsetY = (minimapH - renderedH) / 2;

  const minimapRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const navigateFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const el = minimapRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      // Convert minimap click position back to map coordinates
      const clickX = (clientX - rect.left - offsetX) / scale + contentMinX;
      const clickY = (clientY - rect.top - offsetY) / scale + contentMinY;
      onNavigate(clickX, clickY);
    },
    [scale, offsetX, offsetY, contentMinX, contentMinY, onNavigate],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      e.preventDefault();
      setIsDragging(true);
      navigateFromEvent(e.clientX, e.clientY);
    },
    [navigateFromEvent],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!isDragging) return;
      navigateFromEvent(e.clientX, e.clientY);
    },
    [isDragging, navigateFromEvent],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Helper: convert tile position to minimap position
  const toMiniX = (tilePx: number) => (tilePx - contentMinX) * scale + offsetX;
  const toMiniY = (tilePx: number) => (tilePx - contentMinY) * scale + offsetY;

  // Viewport rectangle
  let vpRect = null;
  if (viewport && containerSize.width > 0) {
    const vpX = toMiniX(-viewport.offset.x / viewport.zoom);
    const vpY = toMiniY(-viewport.offset.y / viewport.zoom);
    const vpW = (containerSize.width / viewport.zoom) * scale;
    const vpH = (containerSize.height / viewport.zoom) * scale;
    vpRect = { x: vpX, y: vpY, width: vpW, height: vpH };
  }

  return (
    <div
      ref={minimapRef}
      className="office-panel relative"
      style={{
        width: minimapW,
        height: minimapH,
        borderRadius: 4,
        overflow: 'hidden',
        cursor: isDragging ? 'grabbing' : 'crosshair',
        flexShrink: 0,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
    >
      {/* Background */}
      <div style={{ position: 'absolute', inset: 0, background: OFFICE.exterior }} />

      {/* Room rectangles */}
      {mapModel.rooms.map((room) => (
        <div
          key={room.id}
          style={{
            position: 'absolute',
            left: toMiniX(room.tileX * TILE_PX),
            top: toMiniY(room.tileY * TILE_PX),
            width: room.tileW * TILE_PX * scale,
            height: room.tileH * TILE_PX * scale,
            backgroundColor: room.type === 'lobby' ? OFFICE.floorLobby : OFFICE.floorMain,
            borderRadius: 1,
            opacity: 0.8,
          }}
        />
      ))}

      {/* Robot dots */}
      {mapModel.objects
        .filter((obj) => obj.type === 'robot')
        .map((obj) => (
          <div
            key={obj.id}
            style={{
              position: 'absolute',
              left: toMiniX(obj.tileX * TILE_PX) - 1.5,
              top: toMiniY(obj.tileY * TILE_PX) - 1.5,
              width: 3,
              height: 3,
              borderRadius: '50%',
              backgroundColor: OFFICE.robotBody,
            }}
          />
        ))}

      {/* Viewport rectangle */}
      {vpRect && (
        <div
          style={{
            position: 'absolute',
            left: vpRect.x,
            top: vpRect.y,
            width: vpRect.width,
            height: vpRect.height,
            border: '1px solid rgba(255, 255, 255, 0.6)',
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Border frame */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: `2px solid ${OFFICE.panelBorderDim}`,
          borderRadius: 4,
          pointerEvents: 'none',
          boxShadow: 'inset 0 0 8px rgba(0,0,0,0.5)',
        }}
      />
    </div>
  );
});

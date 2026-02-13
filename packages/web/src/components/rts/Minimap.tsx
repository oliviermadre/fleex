import { memo, useCallback } from 'react';
import type { RtsMapModel } from './useRtsMapLayout';
import { ZERG } from './rtsTheme';

interface MinimapProps {
  mapModel: RtsMapModel;
  viewport: { offset: { x: number; y: number }; zoom: number } | null;
  containerSize: { width: number; height: number };
  onNavigate: (mapX: number, mapY: number) => void;
}

export const Minimap = memo(function Minimap({ mapModel, viewport, containerSize, onNavigate }: MinimapProps) {
  const minimapW = 200;
  const minimapH = 150;
  const scaleX = minimapW / Math.max(mapModel.mapWidth, 1);
  const scaleY = minimapH / Math.max(mapModel.mapHeight, 1);
  const scale = Math.min(scaleX, scaleY);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = (e.clientX - rect.left) / scale;
      const clickY = (e.clientY - rect.top) / scale;
      onNavigate(clickX, clickY);
    },
    [scale, onNavigate]
  );

  // Compute viewport rectangle on minimap
  let vpRect = null;
  if (viewport && containerSize.width > 0) {
    const vpX = (-viewport.offset.x / viewport.zoom) * scale;
    const vpY = (-viewport.offset.y / viewport.zoom) * scale;
    const vpW = (containerSize.width / viewport.zoom) * scale;
    const vpH = (containerSize.height / viewport.zoom) * scale;
    vpRect = { x: vpX, y: vpY, width: vpW, height: vpH };
  }

  return (
    <div
      className="rts-panel relative"
      style={{
        width: minimapW,
        height: minimapH,
        borderRadius: 4,
        overflow: 'hidden',
        cursor: 'crosshair',
        flexShrink: 0,
      }}
      onClick={handleClick}
    >
      {/* Minimap background */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: ZERG.terrainBg,
        }}
      />

      {/* Base dots */}
      {mapModel.bases.map((base) => (
        <div
          key={base.repoKey}
          style={{
            position: 'absolute',
            left: base.position.x * scale - 4,
            top: base.position.y * scale - 4,
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: ZERG.creepLight,
            boxShadow: `0 0 4px ${ZERG.creepGlow}`,
          }}
        />
      ))}

      {/* Unit dots */}
      {mapModel.units.map((unit) => (
        <div
          key={unit.session.id}
          style={{
            position: 'absolute',
            left: unit.position.x * scale - 1.5,
            top: unit.position.y * scale - 1.5,
            width: 3,
            height: 3,
            borderRadius: '50%',
            backgroundColor:
              unit.session.type === 'claude'
                ? unit.session.claudeActivity === 'working' || unit.session.claudeActivity === 'executing'
                  ? ZERG.activeGreen
                  : ZERG.droneBody
                : ZERG.overlordBody,
          }}
        />
      ))}

      {/* Nydus dot */}
      {mapModel.nydus && (
        <div
          style={{
            position: 'absolute',
            left: mapModel.nydus.position.x * scale - 3,
            top: mapModel.nydus.position.y * scale - 3,
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: ZERG.nydusRing,
            boxShadow: `0 0 4px ${ZERG.nydusGlow}`,
          }}
        />
      )}

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

      {/* Chitin border frame overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          border: `2px solid ${ZERG.carapaceBorderDim}`,
          borderRadius: 4,
          pointerEvents: 'none',
          boxShadow: `inset 0 0 8px rgba(0,0,0,0.5)`,
        }}
      />
    </div>
  );
});

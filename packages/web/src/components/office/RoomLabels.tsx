import { memo } from 'react';
import type { OfficeRoom } from './types';
import { TILE_PX } from './types';
import { OFFICE } from './officeTheme';

interface RoomLabelsProps {
  rooms: OfficeRoom[];
}

/** Room name labels positioned above rooms */
export const RoomLabels = memo(function RoomLabels({ rooms }: RoomLabelsProps) {
  return (
    <>
      {rooms.map((room) => {
        // Skip lobby label (it's always visible)
        if (room.type === 'lobby') {
          return (
            <div
              key={room.id}
              style={{
                position: 'absolute',
                left: room.tileX * TILE_PX,
                top: (room.tileY - 1) * TILE_PX,
                width: room.tileW * TILE_PX,
                textAlign: 'center',
                color: OFFICE.textSecondary,
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 1,
                textTransform: 'uppercase',
                textShadow: `0 1px 4px ${OFFICE.exteriorDark}`,
                pointerEvents: 'none',
                zIndex: 2,
              }}
            >
              Lobby
            </div>
          );
        }

        return (
          <div
            key={room.id}
            style={{
              position: 'absolute',
              left: room.tileX * TILE_PX,
              top: (room.tileY - 2) * TILE_PX,
              width: room.tileW * TILE_PX,
              textAlign: 'center',
              pointerEvents: 'none',
              zIndex: 2,
            }}
          >
            <span
              style={{
                color: OFFICE.textPrimary,
                fontSize: 12,
                fontWeight: 600,
                padding: '2px 8px',
                backgroundColor: 'rgba(26, 29, 35, 0.8)',
                borderRadius: 4,
                border: `1px solid ${OFFICE.panelBorderDim}`,
              }}
            >
              {room.label}
            </span>
          </div>
        );
      })}
    </>
  );
});

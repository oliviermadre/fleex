import { memo } from 'react';
import type { RtsNydusModel } from './useRtsMapLayout';
import type { RtsSelection } from '../../stores/uiStore';
import { ZERG, SPRITE, SELECTION_OUTLINE_FILTER } from './rtsTheme';
import { CreepTexture } from './CreepTexture';
import { UnitSprite } from './UnitSprite';

interface NydusNetworkProps {
  nydus: RtsNydusModel;
  rtsSelection: RtsSelection;
  displayNames: Record<string, string>;
  units: Array<{ session: import('@asm/shared').Session; position: { x: number; y: number } }>;
  unitOverrides: Record<string, { x: number; y: number }>;
  onSelect: (selection: RtsSelection) => void;
  onFocusSession: (sessionId: string) => void;
}

export const NydusNetwork = memo(function NydusNetwork({
  nydus,
  rtsSelection,
  displayNames,
  units,
  unitOverrides,
  onSelect,
  onFocusSession,
}: NydusNetworkProps) {
  const { position, sessions, creepRadius } = nydus;
  const isSelected = rtsSelection?.type === 'nydus';
  const tunnelSize = SPRITE.nydus.size;

  return (
    <>
      {/* Nydus creep */}
      <CreepTexture x={position.x} y={position.y} radius={creepRadius} variant="nydus" />

      {/* Nydus tunnel structure */}
      <div
        style={{
          position: 'absolute',
          left: position.x - tunnelSize / 2,
          top: position.y - tunnelSize / 2,
          width: tunnelSize,
          height: tunnelSize,
          cursor: 'pointer',
        }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect({ type: 'nydus' });
        }}
      >
        {/* Nydus sprite */}
        <img
          src={SPRITE.nydus.src}
          alt="Nydus Network"
          draggable={false}
          style={{
            width: tunnelSize,
            height: tunnelSize,
            objectFit: 'contain',
            filter: isSelected
              ? SELECTION_OUTLINE_FILTER
              : `drop-shadow(0 0 6px ${ZERG.nydusGlow})`,
            animation: isSelected ? undefined : 'rts-hatchery-glow 3s ease-in-out infinite',
            transition: 'filter 0.3s ease',
            imageRendering: 'auto',
          }}
        />

        {/* Label */}
        <div
          style={{
            position: 'absolute',
            top: SPRITE.nydus.labelOffset,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontSize: 10,
            fontWeight: 600,
            color: ZERG.textPrimary,
            textShadow: '0 1px 4px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
          }}
        >
          Nydus Network
        </div>
        <div
          style={{
            position: 'absolute',
            top: SPRITE.nydus.labelOffset + 13,
            left: '50%',
            transform: 'translateX(-50%)',
            whiteSpace: 'nowrap',
            fontSize: 8,
            color: ZERG.textMuted,
            textShadow: '0 1px 3px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
          }}
        >
          {sessions.length} orphaned unit{sessions.length !== 1 ? 's' : ''}
        </div>
      </div>

      {/* Render orphaned units */}
      {units.map((u) => {
        const override = unitOverrides[u.session.id];
        return (
          <UnitSprite
            key={u.session.id}
            session={u.session}
            x={override?.x ?? u.position.x}
            y={override?.y ?? u.position.y}
            selected={rtsSelection?.type === 'session' && rtsSelection.sessionId === u.session.id}
            displayName={displayNames[u.session.id]}
            onSelect={onSelect}
            onDoubleClick={onFocusSession}
          />
        );
      })}
    </>
  );
});

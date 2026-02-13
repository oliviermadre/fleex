import { memo } from 'react';
import type { Session } from '@asm/shared';
import type { RtsSelection } from '../../stores/uiStore';
import { ZERG, SPRITE, SELECTION_OUTLINE_FILTER } from './rtsTheme';

interface UnitSpriteProps {
  session: Session;
  x: number;
  y: number;
  selected: boolean;
  displayName?: string;
  onSelect: (selection: RtsSelection) => void;
  onDoubleClick?: (sessionId: string) => void;
}

export const UnitSprite = memo(function UnitSprite({
  session,
  x,
  y,
  selected,
  displayName,
  onSelect,
  onDoubleClick,
}: UnitSpriteProps) {
  const isDrone = session.type === 'claude';
  const activity = session.claudeActivity ?? 'idle';
  const sprite = isDrone ? SPRITE.drone : SPRITE.overlord;
  const size = sprite.size;

  // Determine animation based on activity
  let animation = '';
  let glowColor = 'transparent';
  let showExclamation = false;

  if (isDrone) {
    switch (activity) {
      case 'working':
        animation = 'rts-drone-working 1.5s ease-in-out infinite';
        glowColor = ZERG.activeGreenGlow;
        break;
      case 'executing':
        animation = 'rts-drone-executing 0.6s ease-in-out infinite';
        glowColor = ZERG.activeGreenGlow;
        break;
      case 'waiting_tool_approval':
      case 'waiting_user_choice':
      case 'waiting_plan_approval':
        animation = 'rts-drone-idle 2s ease-in-out infinite';
        glowColor = ZERG.waitingAmberGlow;
        showExclamation = true;
        break;
      default:
        animation = 'rts-drone-idle 3s ease-in-out infinite';
        break;
    }
  } else {
    animation = 'rts-overlord-float 4s ease-in-out infinite';
  }

  // Drop-shadow filter for sprite glow
  const spriteFilter = selected
    ? SELECTION_OUTLINE_FILTER
    : glowColor !== 'transparent'
      ? `drop-shadow(0 0 6px ${glowColor})`
      : 'drop-shadow(0 2px 3px rgba(0,0,0,0.5))';

  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        cursor: 'pointer',
        animation,
        zIndex: selected ? 10 : 1,
        transition: 'left 0.6s ease-out, top 0.6s ease-out',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ type: 'session', sessionId: session.id });
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onDoubleClick?.(session.id);
      }}
      title={displayName || session.id}
    >
      <img
        src={sprite.src}
        alt={isDrone ? 'Drone' : 'Overlord'}
        draggable={false}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          filter: spriteFilter,
          imageRendering: 'auto',
          transition: 'filter 0.3s ease',
        }}
      />

      {/* Waiting exclamation */}
      {showExclamation && (
        <div
          style={{
            position: 'absolute',
            top: -10,
            left: '50%',
            transform: 'translateX(-50%)',
            color: ZERG.waitingAmber,
            fontSize: 12,
            fontWeight: 900,
            animation: 'rts-waiting-blink 1.2s ease-in-out infinite',
            textShadow: `0 0 4px ${ZERG.waitingAmberGlow}`,
            pointerEvents: 'none',
          }}
        >
          !
        </div>
      )}

      {/* Display name label (always visible) */}
      <div
        style={{
          position: 'absolute',
          top: sprite.labelOffset,
          left: '50%',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
          fontSize: 9,
          fontWeight: 600,
          color: selected ? ZERG.textPrimary : '#e0dce8',
          background: 'rgba(10, 5, 20, 0.75)',
          padding: '1px 5px',
          borderRadius: 3,
          border: `1px solid rgba(100, 70, 150, 0.3)`,
          textShadow: selected ? `0 0 6px ${ZERG.selectionRing}, 0 0 12px ${ZERG.selectionGlow}` : undefined,
          pointerEvents: 'none',
        }}
      >
        {displayName || session.tmuxName}
      </div>
    </div>
  );
});

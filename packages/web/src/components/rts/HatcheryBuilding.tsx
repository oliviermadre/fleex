import { memo } from 'react';
import type { Session } from '@asm/shared';
import type { RtsSelection } from '../../stores/uiStore';
import { ZERG, SPRITE, SELECTION_OUTLINE_FILTER } from './rtsTheme';

interface HatcheryBuildingProps {
  x: number;
  y: number;
  repoKey: string;
  repoName: string;
  sessions: Session[];
  selected: boolean;
  onSelect: (selection: RtsSelection) => void;
}

const HATCHERY_SIZE = SPRITE.hatchery.size;

export const HatcheryBuilding = memo(function HatcheryBuilding({
  x,
  y,
  repoKey,
  repoName,
  sessions,
  selected,
  onSelect,
}: HatcheryBuildingProps) {
  // Determine activity level from sessions
  const hasWorking = sessions.some((s) => s.claudeActivity === 'working');
  const hasExecuting = sessions.some((s) => s.claudeActivity === 'executing');
  const hasWaiting = sessions.some(
    (s) =>
      s.claudeActivity === 'waiting_tool_approval' ||
      s.claudeActivity === 'waiting_user_choice' ||
      s.claudeActivity === 'waiting_plan_approval'
  );

  let glowColor: string = ZERG.hatcheryIdle;
  if (hasExecuting) {
    glowColor = ZERG.activeGreen;
  } else if (hasWorking) {
    glowColor = ZERG.activeGreen;
  } else if (hasWaiting) {
    glowColor = ZERG.hatcheryWaiting;
  }

  return (
    <div
      style={{
        position: 'absolute',
        left: x - HATCHERY_SIZE / 2,
        top: y - HATCHERY_SIZE / 2,
        width: HATCHERY_SIZE,
        height: HATCHERY_SIZE,
        cursor: 'pointer',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ type: 'hatchery', repoKey });
      }}
    >
      {/* Hatchery sprite */}
      <img
        src={SPRITE.hatchery.src}
        alt="Hatchery"
        draggable={false}
        style={{
          width: HATCHERY_SIZE,
          height: HATCHERY_SIZE,
          objectFit: 'contain',
          filter: selected
            ? SELECTION_OUTLINE_FILTER
            : `drop-shadow(0 0 6px ${glowColor})`,
          animation: selected ? undefined : 'rts-hatchery-glow 3s ease-in-out infinite',
          transition: 'filter 0.3s ease',
          imageRendering: 'auto',
        }}
      />

      {/* Repo name label */}
      <div
        style={{
          position: 'absolute',
          top: SPRITE.hatchery.labelOffset,
          left: '50%',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
          fontSize: 11,
          fontWeight: 600,
          color: ZERG.textPrimary,
          textShadow: '0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
        }}
      >
        {repoName}
      </div>
    </div>
  );
});

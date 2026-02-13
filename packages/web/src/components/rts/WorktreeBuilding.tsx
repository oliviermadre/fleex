import { memo } from 'react';
import type { PullRequest } from '@asm/shared';
import type { RtsSelection } from '../../stores/uiStore';
import { ZERG, SPRITE, SELECTION_OUTLINE_FILTER, getBuildingType } from './rtsTheme';

interface WorktreeBuildingProps {
  x: number;
  y: number;
  branch: string;
  repoKey: string;
  sessionCount: number;
  isMain: boolean;
  pr: PullRequest | null;
  selected: boolean;
  onSelect: (selection: RtsSelection) => void;
}

export const WorktreeBuilding = memo(function WorktreeBuilding({
  x,
  y,
  branch,
  repoKey,
  sessionCount,
  isMain,
  pr,
  selected,
  onSelect,
}: WorktreeBuildingProps) {
  const buildingType = getBuildingType({
    isMain,
    hasOpenPR: !!pr,
    sessionCount,
  });

  const sprite = isMain ? SPRITE.spawningPool : SPRITE.evoChamber;
  const size = sprite.size;

  return (
    <div
      style={{
        position: 'absolute',
        left: x - size / 2,
        top: y - size / 2,
        width: size,
        height: size,
        cursor: 'pointer',
      }}
      onClick={(e) => {
        e.stopPropagation();
        onSelect({ type: 'worktree', repoKey, branch });
      }}
    >
      <img
        src={sprite.src}
        alt={buildingType.label}
        draggable={false}
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          filter: selected
            ? SELECTION_OUTLINE_FILTER
            : `drop-shadow(0 0 6px ${buildingType.color})`,
          transition: 'filter 0.3s ease',
          imageRendering: 'auto',
        }}
      />

      {/* PR badge */}
      {pr && (
        <div
          style={{
            position: 'absolute',
            top: -6,
            right: -6,
            width: 16,
            height: 16,
            borderRadius: '50%',
            backgroundColor: ZERG.evolutionChamber,
            color: '#000',
            fontSize: 8,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: `0 0 4px ${ZERG.waitingAmberGlow}`,
          }}
        >
          {pr.number}
        </div>
      )}

      {/* Branch name label */}
      <div
        style={{
          position: 'absolute',
          top: sprite.labelOffset,
          left: '50%',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
          fontSize: 9,
          color: ZERG.textPrimary,
          fontWeight: 600,
          textShadow: '0 1px 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)',
          pointerEvents: 'none',
          maxWidth: 100,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {branch}
      </div>

      {/* Building type tooltip on hover */}
      <div
        style={{
          position: 'absolute',
          bottom: size + 3,
          left: '50%',
          transform: 'translateX(-50%)',
          whiteSpace: 'nowrap',
          fontSize: 8,
          color: buildingType.color,
          textShadow: '0 1px 3px rgba(0,0,0,0.9)',
          pointerEvents: 'none',
          opacity: selected ? 1 : 0,
          transition: 'opacity 0.2s',
        }}
      >
        {buildingType.label}
      </div>
    </div>
  );
});

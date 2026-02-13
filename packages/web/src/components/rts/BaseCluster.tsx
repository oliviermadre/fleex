import { memo } from 'react';
import type { PullRequest } from '@asm/shared';
import type { RtsBaseModel } from './useRtsMapLayout';
import type { RtsSelection } from '../../stores/uiStore';
import { CreepTexture } from './CreepTexture';
import { HatcheryBuilding } from './HatcheryBuilding';
import { WorktreeBuilding } from './WorktreeBuilding';
import { UnitSprite } from './UnitSprite';

interface BaseClusterProps {
  base: RtsBaseModel;
  rtsSelection: RtsSelection;
  pullsByBranch: Record<string, PullRequest>;
  displayNames: Record<string, string>;
  units: Array<{ session: import('@asm/shared').Session; position: { x: number; y: number } }>;
  unitOverrides: Record<string, { x: number; y: number }>;
  onSelect: (selection: RtsSelection) => void;
  onFocusSession: (sessionId: string) => void;
}

export const BaseCluster = memo(function BaseCluster({
  base,
  rtsSelection,
  pullsByBranch,
  displayNames,
  units,
  unitOverrides,
  onSelect,
  onFocusSession,
}: BaseClusterProps) {
  const isHatcherySelected =
    rtsSelection?.type === 'hatchery' && rtsSelection.repoKey === base.repoKey;

  return (
    <>
      {/* Creep spread */}
      <CreepTexture x={base.position.x} y={base.position.y} radius={base.creepRadius} />

      {/* Worktree buildings */}
      {base.worktrees.map((wt) => {
        const isWtSelected =
          rtsSelection?.type === 'worktree' &&
          rtsSelection.repoKey === base.repoKey &&
          rtsSelection.branch === wt.branch;

        return (
          <WorktreeBuilding
            key={wt.branch}
            x={wt.position.x}
            y={wt.position.y}
            branch={wt.branch}
            repoKey={base.repoKey}
            sessionCount={wt.sessions.length}
            isMain={wt.isMain}
            pr={pullsByBranch[wt.branch] ?? null}
            selected={isWtSelected}
            onSelect={onSelect}
          />
        );
      })}

      {/* Hatchery (center, rendered after buildings to sit on top) */}
      <HatcheryBuilding
        x={base.position.x}
        y={base.position.y}
        repoKey={base.repoKey}
        repoName={base.name}
        sessions={base.sessions}
        selected={isHatcherySelected}
        onSelect={onSelect}
      />

      {/* Session units */}
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

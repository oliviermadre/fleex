import { useMemo } from 'react';
import type { SessionGroup, Session } from '@asm/shared';

export interface RtsPosition {
  x: number;
  y: number;
}

export interface RtsBaseModel {
  repoKey: string;
  org: string;
  name: string;
  position: RtsPosition;
  creepRadius: number;
  worktrees: RtsWorktreeModel[];
  sessions: Session[];
}

export interface RtsWorktreeModel {
  branch: string;
  path: string;
  position: RtsPosition;
  sessions: Session[];
  isMain: boolean;
}

export interface RtsUnitModel {
  session: Session;
  position: RtsPosition;
  parentType: 'worktree' | 'nydus';
}

export interface RtsNydusModel {
  position: RtsPosition;
  sessions: Session[];
  creepRadius: number;
}

export interface RtsMapModel {
  bases: RtsBaseModel[];
  units: RtsUnitModel[];
  nydus: RtsNydusModel | null;
  mapWidth: number;
  mapHeight: number;
}

// Default branch names used to identify the "Main" worktree
const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'dev']);

// Layout constants
const HATCHERY_ORBIT_RADIUS = 380; // Distance of hatcheries from Nydus center
const MAIN_OFFSET = 120; // Distance of "Main" building from hatchery center
const WORKTREE_RING_RADIUS = 110; // Distance of worktree buildings from hatchery center
const UNIT_ARC_RADIUS = 55; // Distance of units from their worktree
const MIN_MAP_SIZE = 1200;

export function useRtsMapLayout(sessionGroups: SessionGroup[]): RtsMapModel {
  return useMemo(() => {
    const repoGroups = sessionGroups.filter(
      (g) => !(g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped')
    );
    const ungrouped = sessionGroups.find(
      (g) => g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped'
    );

    // Map size based on number of bases
    const orbitRadius = repoGroups.length <= 1
      ? 0
      : HATCHERY_ORBIT_RADIUS + Math.max(0, repoGroups.length - 4) * 60;
    const mapSize = Math.max(MIN_MAP_SIZE, orbitRadius * 2 + 600);
    const center = { x: mapSize / 2, y: mapSize / 2 };

    const bases: RtsBaseModel[] = [];
    const units: RtsUnitModel[] = [];

    // Place hatcheries in a circle around map center (Nydus position)
    repoGroups.forEach((group, index) => {
      const angle = (index / Math.max(repoGroups.length, 1)) * Math.PI * 2 - Math.PI / 2;
      const baseX = repoGroups.length === 1
        ? center.x
        : center.x + Math.cos(angle) * orbitRadius;
      const baseY = repoGroups.length === 1
        ? center.y
        : center.y + Math.sin(angle) * orbitRadius;

      const allSessions = group.worktrees.flatMap((wt) => wt.sessions);

      // Separate main worktree from other worktrees
      const mainWorktrees = group.worktrees.filter((wt) => DEFAULT_BRANCHES.has(wt.branch));
      const otherWorktrees = group.worktrees.filter((wt) => !DEFAULT_BRANCHES.has(wt.branch));

      const worktrees: RtsWorktreeModel[] = [];

      // Place "Main" worktree directly adjacent to hatchery
      mainWorktrees.forEach((wt, mIdx) => {
        // If only one base, place Main above; otherwise, point inward toward Nydus
        const mainAngle = repoGroups.length === 1
          ? -Math.PI / 2
          : angle + Math.PI; // Point toward center
        const offsetAngle = mainAngle + (mIdx - (mainWorktrees.length - 1) / 2) * 0.5;
        const wtX = baseX + Math.cos(offsetAngle) * MAIN_OFFSET;
        const wtY = baseY + Math.sin(offsetAngle) * MAIN_OFFSET;

        // Place units near the Main building
        wt.sessions.forEach((session, sIdx) => {
          const unitAngle = offsetAngle + ((sIdx - (wt.sessions.length - 1) / 2) * 0.8);
          units.push({
            session,
            position: {
              x: wtX + Math.cos(unitAngle) * UNIT_ARC_RADIUS,
              y: wtY + Math.sin(unitAngle) * UNIT_ARC_RADIUS,
            },
            parentType: 'worktree',
          });
        });

        worktrees.push({
          branch: wt.branch,
          path: wt.path,
          position: { x: wtX, y: wtY },
          sessions: wt.sessions,
          isMain: true,
        });
      });

      // Place other worktrees in a ring around the hatchery (outward from Nydus)
      otherWorktrees.forEach((wt, wtIdx) => {
        // Spread worktrees in an arc on the far side from Nydus
        const arcSpread = Math.min(Math.PI * 0.8, otherWorktrees.length * 0.5);
        const startAngle = angle - arcSpread / 2;
        const wtAngle = otherWorktrees.length === 1
          ? angle
          : startAngle + (wtIdx / (otherWorktrees.length - 1)) * arcSpread;
        const wtX = baseX + Math.cos(wtAngle) * WORKTREE_RING_RADIUS;
        const wtY = baseY + Math.sin(wtAngle) * WORKTREE_RING_RADIUS;

        // Place units near this worktree
        wt.sessions.forEach((session, sIdx) => {
          const unitAngle = wtAngle + ((sIdx - (wt.sessions.length - 1) / 2) * 0.8);
          units.push({
            session,
            position: {
              x: wtX + Math.cos(unitAngle) * UNIT_ARC_RADIUS,
              y: wtY + Math.sin(unitAngle) * UNIT_ARC_RADIUS,
            },
            parentType: 'worktree',
          });
        });

        worktrees.push({
          branch: wt.branch,
          path: wt.path,
          position: { x: wtX, y: wtY },
          sessions: wt.sessions,
          isMain: false,
        });
      });

      // Creep radius must encompass all buildings + some padding
      const maxBuildingDist = Math.max(
        MAIN_OFFSET + 30,
        WORKTREE_RING_RADIUS + 30,
        ...worktrees.map((wt) => {
          const dx = wt.position.x - baseX;
          const dy = wt.position.y - baseY;
          return Math.sqrt(dx * dx + dy * dy) + 30;
        })
      );
      const creepRadius = maxBuildingDist + 20;

      bases.push({
        repoKey: `${group.repositoryOrg}/${group.repositoryName}`,
        org: group.repositoryOrg,
        name: group.repositoryName,
        position: { x: baseX, y: baseY },
        creepRadius,
        worktrees,
        sessions: allSessions,
      });
    });

    // Nydus Network at map center (always present as the hub)
    let nydus: RtsNydusModel | null = null;
    const ungroupedSessions = ungrouped
      ? ungrouped.worktrees.flatMap((wt) => wt.sessions)
      : [];

    // Always show Nydus at center if there are bases, or if there are ungrouped sessions
    if (repoGroups.length > 0 || ungroupedSessions.length > 0) {
      const nydusCreepRadius = 80 + Math.min(ungroupedSessions.length * 10, 80);

      ungroupedSessions.forEach((session, idx) => {
        const angle = (idx / Math.max(ungroupedSessions.length, 1)) * Math.PI * 2 - Math.PI / 2;
        units.push({
          session,
          position: {
            x: center.x + Math.cos(angle) * 60,
            y: center.y + Math.sin(angle) * 60,
          },
          parentType: 'nydus',
        });
      });

      nydus = {
        position: center,
        sessions: ungroupedSessions,
        creepRadius: nydusCreepRadius,
      };
    }

    return { bases, units, nydus, mapWidth: mapSize, mapHeight: mapSize };
  }, [sessionGroups]);
}

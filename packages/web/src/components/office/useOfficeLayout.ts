import { useMemo } from 'react';
import type { SessionGroup, RepositorySummary } from '@asm/shared';
import type {
  OfficeMapModel,
  OfficeRoom,
  MapObject,
  CorridorSegment,
  TileLayer,
  TileId,
} from './types';
import {
  TILE_PX,
  ROOM_WIDTH,
  ROOM_HEIGHT,
  CORRIDOR_WIDTH,
  MAX_ROOMS_PER_ROW,
  ROOM_GAP,
  DESKS_PER_ROOM,
} from './types';

const DEFAULT_BRANCHES = new Set(['main', 'master', 'develop', 'dev']);

/** Lobby room size (fixed) */
const LOBBY_WIDTH = 12;
const LOBBY_HEIGHT = 8;

/**
 * Internal room layout (12x11 tiles):
 *
 *  Col: 0 1 2 3 4 5 6 7 8 9 A B
 *   0:  W W W W W D W W W W W W     D=door
 *   1:  W . WB WB . . . . . B W     WB=whiteboard(2x1), B=bookshelf
 *   2:  W . s1 s1 . s2 s2 . B W     s=desk sign(2x1)
 *   3:  W . DD DD . DD DD . B W     DD=desk(2x1)
 *   4:  W . R  .  . R  .  . . W     R=robot(1x1)
 *   5:  W . . . . . . . . . . W
 *   6:  W . s3 s3 . s4 s4 . . W
 *   7:  W . DD DD . DD DD . . W
 *   8:  W . R  .  . R  .  . . W
 *   9:  W . . . . DV . . PL . W     DV=delivery, PL=work-pile
 *  10:  W W W W W W W W W W W W
 */

/** Desk slot positions relative to room origin */
const DESK_SLOTS: { signX: number; signY: number; deskX: number; deskY: number; robotX: number; robotY: number }[] = [
  { signX: 2, signY: 2, deskX: 2, deskY: 3, robotX: 2, robotY: 4 }, // slot 1 (top-left)
  { signX: 5, signY: 2, deskX: 5, deskY: 3, robotX: 5, robotY: 4 }, // slot 2 (top-right)
  { signX: 2, signY: 6, deskX: 2, deskY: 7, robotX: 2, robotY: 8 }, // slot 3 (bottom-left)
  { signX: 5, signY: 6, deskX: 5, deskY: 7, robotX: 5, robotY: 8 }, // slot 4 (bottom-right)
];

export function useOfficeLayout(
  sessionGroups: SessionGroup[],
  resolvedRepositories: string[],
  summaries: Record<string, RepositorySummary>,
): OfficeMapModel {
  return useMemo(() => {
    const repoGroups = sessionGroups.filter(
      (g) => !(g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped'),
    );
    const ungrouped = sessionGroups.find(
      (g) => g.repositoryOrg === '_ungrouped' && g.repositoryName === '_ungrouped',
    );

    // Build a lookup from repoKey -> SessionGroup
    const groupByRepo = new Map<string, SessionGroup>();
    for (const g of repoGroups) {
      groupByRepo.set(`${g.repositoryOrg}/${g.repositoryName}`, g);
    }

    // Determine which repos get rooms: all resolvedRepositories, plus any repos that have active sessions but aren't in resolvedRepositories
    const repoSet = new Set<string>(resolvedRepositories);
    for (const key of groupByRepo.keys()) {
      repoSet.add(key);
    }
    const allRepoKeys = [...repoSet];

    const rooms: OfficeRoom[] = [];
    const objects: MapObject[] = [];
    const corridors: CorridorSegment[] = [];

    // --- 1. Lobby at top center ---
    const lobbyPadTop = 2;

    // --- 2. Arrange rooms in rows ---
    const rows: string[][] = [];
    for (let i = 0; i < allRepoKeys.length; i += MAX_ROOMS_PER_ROW) {
      rows.push(allRepoKeys.slice(i, i + MAX_ROOMS_PER_ROW));
    }

    // Calculate total map width
    const maxRoomsInRow = Math.min(MAX_ROOMS_PER_ROW, allRepoKeys.length || 1);
    const rowWidth = maxRoomsInRow * ROOM_WIDTH + (maxRoomsInRow - 1) * ROOM_GAP;
    const totalMapWidth = Math.max(LOBBY_WIDTH, rowWidth) + ROOM_GAP * 2;

    // Place lobby centered at top
    const lobbyX = Math.floor((totalMapWidth - LOBBY_WIDTH) / 2);
    const lobbyY = lobbyPadTop;
    rooms.push({
      id: 'lobby',
      type: 'lobby',
      label: 'Lobby',
      tileX: lobbyX,
      tileY: lobbyY,
      tileW: LOBBY_WIDTH,
      tileH: LOBBY_HEIGHT,
    });

    // Place ungrouped sessions in the lobby
    const ungroupedSessions = ungrouped
      ? ungrouped.worktrees.flatMap((wt) => wt.sessions)
      : [];
    let lobbySlot = 0;
    ungroupedSessions.forEach((session) => {
      const col = lobbySlot % 4;
      const row = Math.floor(lobbySlot / 4);
      const slotX = lobbyX + 2 + col * 2;
      const slotY = lobbyY + 3 + row * 2;

      if (session.type === 'claude') {
        objects.push({
          id: `lobby-robot-${session.id}`,
          type: 'robot',
          tileX: slotX,
          tileY: slotY,
          tileW: 1,
          tileH: 1,
          binding: { type: 'session', sessionId: session.id },
          zLayer: 10,
          roomId: 'lobby',
        });
      } else {
        objects.push({
          id: `lobby-desk-${session.id}`,
          type: 'desk',
          tileX: slotX,
          tileY: slotY,
          tileW: 2,
          tileH: 1,
          binding: { type: 'session', sessionId: session.id },
          zLayer: 5,
          roomId: 'lobby',
        });
        objects.push({
          id: `lobby-computer-${session.id}`,
          type: 'computer',
          tileX: slotX,
          tileY: slotY,
          tileW: 1,
          tileH: 1,
          binding: { type: 'session', sessionId: session.id },
          zLayer: 6,
          roomId: 'lobby',
        });
      }
      lobbySlot++;
    });

    // --- 3. Place open-space rooms below lobby with grid corridors ---
    const firstCorridorY = lobbyY + LOBBY_HEIGHT; // corridor starts right below lobby

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx]!;
      const roomsInRow = row.length;
      const thisRowWidth = roomsInRow * ROOM_WIDTH + (roomsInRow - 1) * ROOM_GAP;
      const rowStartX = Math.floor((totalMapWidth - thisRowWidth) / 2);

      // Corridor Y position for this row
      const corridorY = firstCorridorY + rowIdx * (ROOM_HEIGHT + CORRIDOR_WIDTH);
      const roomY = corridorY + CORRIDOR_WIDTH;

      // Horizontal corridor spanning the full row width
      const corridorLeft = rowStartX + Math.floor(ROOM_WIDTH / 2) - 1;
      const corridorRight = rowStartX + thisRowWidth - Math.floor(ROOM_WIDTH / 2) + 1;

      if (roomsInRow > 1) {
        corridors.push({
          x1: corridorLeft,
          y1: corridorY,
          x2: corridorRight,
          y2: corridorY + CORRIDOR_WIDTH - 1,
          width: CORRIDOR_WIDTH,
        });
      }

      // Vertical connector from lobby to first horizontal corridor
      if (rowIdx === 0) {
        const lobbyCenterX = lobbyX + Math.floor(LOBBY_WIDTH / 2);
        corridors.push({
          x1: lobbyCenterX,
          y1: firstCorridorY,
          x2: lobbyCenterX,
          y2: corridorY + CORRIDOR_WIDTH - 1,
          width: CORRIDOR_WIDTH,
        });
      }

      // Vertical connector between corridor rows
      if (rowIdx > 0) {
        const prevCorridorY = firstCorridorY + (rowIdx - 1) * (ROOM_HEIGHT + CORRIDOR_WIDTH);
        const prevRoomBottomY = prevCorridorY + CORRIDOR_WIDTH + ROOM_HEIGHT;
        // Connect from bottom of previous rooms to this corridor
        const connectorX = lobbyX + Math.floor(LOBBY_WIDTH / 2);
        corridors.push({
          x1: connectorX,
          y1: prevRoomBottomY,
          x2: connectorX,
          y2: corridorY + CORRIDOR_WIDTH - 1,
          width: CORRIDOR_WIDTH,
        });
      }

      for (let colIdx = 0; colIdx < row.length; colIdx++) {
        const repoKey = row[colIdx]!;
        const roomId = `room-${repoKey}`;
        const roomX = rowStartX + colIdx * (ROOM_WIDTH + ROOM_GAP);
        const repoName = repoKey.split('/')[1] ?? repoKey;

        rooms.push({
          id: roomId,
          type: 'open-space',
          label: repoName,
          tileX: roomX,
          tileY: roomY,
          tileW: ROOM_WIDTH,
          tileH: ROOM_HEIGHT,
          repoKey,
        });

        // Vertical connector from corridor to room door
        const roomDoorX = roomX + Math.floor(ROOM_WIDTH / 2);
        corridors.push({
          x1: roomDoorX,
          y1: corridorY,
          x2: roomDoorX,
          y2: roomY,
          width: CORRIDOR_WIDTH,
        });

        // Door at top-center of room
        objects.push({
          id: `door-${roomId}`,
          type: 'door',
          tileX: roomX + 5,
          tileY: roomY,
          tileW: 1,
          tileH: 1,
          binding: null,
          zLayer: 5,
          roomId,
        });

        // Sign above door
        objects.push({
          id: `sign-${roomId}`,
          type: 'sign',
          tileX: roomX + 5,
          tileY: roomY - 1,
          tileW: 1,
          tileH: 1,
          binding: { type: 'repo', repoKey },
          zLayer: 5,
          roomId,
        });

        // Whiteboard on north wall (2x1) at col 2-3, row 1
        objects.push({
          id: `whiteboard-${roomId}`,
          type: 'whiteboard',
          tileX: roomX + 2,
          tileY: roomY + 1,
          tileW: 2,
          tileH: 1,
          binding: { type: 'repo', repoKey },
          zLayer: 5,
          roomId,
        });

        // Bookshelf on east wall (1x3) at col 9, rows 1-3
        objects.push({
          id: `bookshelf-${roomId}`,
          type: 'bookshelf',
          tileX: roomX + 9,
          tileY: roomY + 1,
          tileW: 1,
          tileH: 3,
          binding: { type: 'repo-prs', repoKey },
          zLayer: 5,
          roomId,
        });

        // Delivery (1x1) at col 5, row 9
        objects.push({
          id: `delivery-${roomId}`,
          type: 'delivery',
          tileX: roomX + 5,
          tileY: roomY + 9,
          tileW: 1,
          tileH: 1,
          binding: { type: 'repo-merged', repoKey },
          zLayer: 5,
          roomId,
        });

        // Work pile (1x1) at col 8, row 9
        objects.push({
          id: `workpile-${roomId}`,
          type: 'work-pile',
          tileX: roomX + 8,
          tileY: roomY + 9,
          tileW: 1,
          tileH: 1,
          binding: { type: 'repo-assigned', repoKey },
          zLayer: 5,
          roomId,
        });

        // --- Place desks (4 fixed slots per room) ---
        const group = groupByRepo.get(repoKey);
        const worktrees = group ? [...group.worktrees] : [];
        // Sort: default branches first, then others
        const mainWorktrees = worktrees.filter((wt) => DEFAULT_BRANCHES.has(wt.branch));
        const otherWorktrees = worktrees.filter((wt) => !DEFAULT_BRANCHES.has(wt.branch));
        const sortedWorktrees = [...mainWorktrees, ...otherWorktrees];

        for (let slotIdx = 0; slotIdx < DESKS_PER_ROOM; slotIdx++) {
          const slot = DESK_SLOTS[slotIdx]!;
          const wt = sortedWorktrees[slotIdx];
          const occupied = !!wt;

          const deskX = roomX + slot.deskX;
          const deskY = roomY + slot.deskY;
          const signX = roomX + slot.signX;
          const signY = roomY + slot.signY;
          const robotX = roomX + slot.robotX;
          const robotY = roomY + slot.robotY;

          const deskBinding = occupied
            ? { type: 'worktree' as const, repoKey, branch: wt.branch, path: wt.path }
            : null;

          // Sign above desk
          if (occupied) {
            objects.push({
              id: `desksign-${repoKey}-s${slotIdx}`,
              type: 'sign',
              tileX: signX,
              tileY: signY,
              tileW: 2,
              tileH: 1,
              binding: deskBinding,
              zLayer: 4,
              roomId,
            });
          }

          // Desk (2x1) — always placed, empty or occupied
          objects.push({
            id: `desk-${repoKey}-s${slotIdx}`,
            type: 'desk',
            tileX: deskX,
            tileY: deskY,
            tileW: 2,
            tileH: 1,
            binding: deskBinding,
            zLayer: 5,
            roomId,
          });

          // Computer on desk (only if occupied)
          if (occupied) {
            objects.push({
              id: `computer-${repoKey}-s${slotIdx}`,
              type: 'computer',
              tileX: deskX,
              tileY: deskY,
              tileW: 1,
              tileH: 1,
              binding: deskBinding,
              zLayer: 6,
              roomId,
            });
          }

          // Robots for Claude sessions (only if occupied)
          if (occupied) {
            const claudeSessions = wt.sessions.filter((s) => s.type === 'claude');
            claudeSessions.forEach((session, sIdx) => {
              objects.push({
                id: `robot-${session.id}`,
                type: 'robot',
                tileX: robotX + sIdx,
                tileY: robotY,
                tileW: 1,
                tileH: 1,
                binding: { type: 'session', sessionId: session.id },
                zLayer: 10,
                roomId,
              });
            });
          }
        }
      }
    }

    // --- 4. Calculate total map size ---
    const lastRowIdx = rows.length - 1;
    const totalMapHeight = rows.length === 0
      ? lobbyY + LOBBY_HEIGHT + 4
      : firstCorridorY + (lastRowIdx + 1) * (ROOM_HEIGHT + CORRIDOR_WIDTH) + 4;

    // --- 5. Generate tile layers ---
    const layers = generateTileLayers(rooms, corridors, totalMapWidth, totalMapHeight);

    return {
      rooms,
      objects,
      corridors,
      layers,
      mapWidthTiles: totalMapWidth,
      mapHeightTiles: totalMapHeight,
      mapWidth: totalMapWidth * TILE_PX,
      mapHeight: totalMapHeight * TILE_PX,
    };
  }, [sessionGroups, resolvedRepositories, summaries]);
}

/** Generate tile layers from room and corridor geometry */
function generateTileLayers(
  rooms: OfficeRoom[],
  corridors: CorridorSegment[],
  width: number,
  height: number,
): TileLayer[] {
  // Initialize ground layer with exterior
  const ground: (TileId | null)[][] = Array.from({ length: height }, () =>
    Array.from({ length: width }, () => 'exterior' as TileId),
  );

  // Fill corridors first (so room walls paint over corridor edges)
  for (const seg of corridors) {
    const minX = Math.max(0, Math.min(seg.x1, seg.x2) - Math.floor(seg.width / 2));
    const maxX = Math.min(width - 1, Math.max(seg.x1, seg.x2) + Math.floor(seg.width / 2));
    const minY = Math.max(0, Math.min(seg.y1, seg.y2));
    const maxY = Math.min(height - 1, Math.max(seg.y1, seg.y2));

    for (let y = minY; y <= maxY; y++) {
      const row = ground[y];
      if (!row) continue;
      for (let x = minX; x <= maxX; x++) {
        if (row[x] === 'exterior') {
          row[x] = 'corridor';
        }
      }
    }
  }

  // Fill room interiors (overwrites corridor tiles that overlap)
  for (const room of rooms) {
    const floorTile: TileId = room.type === 'lobby' ? 'floor-lobby' : 'floor';

    for (let y = room.tileY; y < room.tileY + room.tileH; y++) {
      for (let x = room.tileX; x < room.tileX + room.tileW; x++) {
        if (y >= 0 && y < height && x >= 0 && x < width) {
          const isTop = y === room.tileY;
          const isBottom = y === room.tileY + room.tileH - 1;
          const isLeft = x === room.tileX;
          const isRight = x === room.tileX + room.tileW - 1;

          const row = ground[y];
          if (!row) continue;
          if (isTop && isLeft) row[x] = 'wall-corner-tl';
          else if (isTop && isRight) row[x] = 'wall-corner-tr';
          else if (isBottom && isLeft) row[x] = 'wall-corner-bl';
          else if (isBottom && isRight) row[x] = 'wall-corner-br';
          else if (isTop) row[x] = 'wall-top';
          else if (isBottom) row[x] = 'wall-bottom';
          else if (isLeft) row[x] = 'wall-left';
          else if (isRight) row[x] = 'wall-right';
          else row[x] = floorTile;
        }
      }
    }

    // Punch door opening into the top wall (door at col 5 of the room)
    if (room.type === 'open-space') {
      const doorX = room.tileX + 5;
      const doorY = room.tileY;
      if (doorY >= 0 && doorY < height && doorX >= 0 && doorX < width) {
        const row = ground[doorY];
        if (row) row[doorX] = 'corridor';
      }
    }
  }

  return [{ name: 'ground', width, height, tiles: ground }];
}

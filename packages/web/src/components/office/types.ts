/** Tile system constants */
export const TILE_SIZE = 16; // Base pixel size (limezu standard)
export const DISPLAY_SCALE = 3; // Render at 48px per tile
export const TILE_PX = TILE_SIZE * DISPLAY_SCALE; // 48px effective display size

/** Room sizing (in tiles) */
export const ROOM_WIDTH = 12;
export const ROOM_HEIGHT = 11;
export const CORRIDOR_WIDTH = 3;
export const MAX_ROOMS_PER_ROW = 3;
export const ROOM_GAP = 4; // Gap between rooms in tiles
export const DESKS_PER_ROOM = 4; // Fixed desk slots per room

/** Object sizes (in tiles) */
export const OBJECT_SIZES: Record<OfficeObjectType, { w: number; h: number }> = {
  desk: { w: 2, h: 1 },
  computer: { w: 1, h: 1 },
  robot: { w: 1, h: 1 },
  whiteboard: { w: 2, h: 1 },
  bookshelf: { w: 1, h: 3 },
  door: { w: 1, h: 1 },
  sign: { w: 1, h: 1 },
  delivery: { w: 1, h: 1 },
  'work-pile': { w: 1, h: 1 },
};

/** Tile types for the canvas layer */
export type TileId =
  | 'floor'
  | 'floor-lobby'
  | 'wall-top'
  | 'wall-bottom'
  | 'wall-left'
  | 'wall-right'
  | 'wall-corner-tl'
  | 'wall-corner-tr'
  | 'wall-corner-bl'
  | 'wall-corner-br'
  | 'corridor'
  | 'exterior';

/** A single layer of tiles (2D grid of TileIds or null) */
export interface TileLayer {
  name: string;
  width: number;
  height: number;
  tiles: (TileId | null)[][];
}

/** Interactive object types */
export type OfficeObjectType =
  | 'desk'
  | 'computer'
  | 'robot'
  | 'whiteboard'
  | 'bookshelf'
  | 'door'
  | 'sign'
  | 'delivery'
  | 'work-pile';

/** Robot status matching Claude session activity */
export type RobotStatus = 'idle' | 'working' | 'thinking' | 'error';

/** A map object (interactive DOM element) */
export interface MapObject {
  id: string;
  type: OfficeObjectType;
  /** Position in tiles */
  tileX: number;
  tileY: number;
  /** Size in tiles */
  tileW: number;
  tileH: number;
  /** Binding to backend entity */
  binding: ObjectBinding | null;
  /** Z-index layer */
  zLayer: number;
  /** Room this object belongs to */
  roomId: string;
}

/** What a map object is bound to */
export type ObjectBinding =
  | { type: 'session'; sessionId: string }
  | { type: 'worktree'; repoKey: string; branch: string; path: string }
  | { type: 'repo'; repoKey: string }
  | { type: 'repo-prs'; repoKey: string }
  | { type: 'repo-merged'; repoKey: string }
  | { type: 'repo-assigned'; repoKey: string }
  | null;

/** Room types */
export type RoomType = 'lobby' | 'open-space' | 'pr-library' | 'machine-room' | 'break-room';

/** A room in the office */
export interface OfficeRoom {
  id: string;
  type: RoomType;
  label: string;
  /** Position in tiles (top-left corner) */
  tileX: number;
  tileY: number;
  /** Size in tiles */
  tileW: number;
  tileH: number;
  /** Binding to repo if open-space */
  repoKey?: string;
}

/** A corridor segment connecting rooms */
export interface CorridorSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number; // in tiles
}

/** Complete office map model */
export interface OfficeMapModel {
  rooms: OfficeRoom[];
  objects: MapObject[];
  corridors: CorridorSegment[];
  layers: TileLayer[];
  /** Total map size in tiles */
  mapWidthTiles: number;
  mapHeightTiles: number;
  /** Total map size in pixels (at display scale) */
  mapWidth: number;
  mapHeight: number;
}

/** Selection type for the office view */
export type OfficeSelection =
  | { type: 'session'; sessionId: string }
  | { type: 'worktree'; repoKey: string; branch: string }
  | { type: 'repo'; repoKey: string }
  | { type: 'room'; roomId: string }
  | { type: 'lobby' }
  | null;

/** Focused data overlay type */
export type DataOverlayTarget =
  | { type: 'pr-library'; repoKey: string }
  | { type: 'merged'; repoKey: string }
  | { type: 'assigned'; repoKey: string }
  | null;

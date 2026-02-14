import type { OfficeObjectType, TileId } from './types';
import { OFFICE } from './officeTheme';

/** Definition for a placeholder sprite (emoji + color) */
export interface PlaceholderAssetDef {
  emoji: string;
  bgColor: string;
  borderColor: string;
  label?: string;
}

/** Placeholder assets for all object types (used before pixel art is loaded) */
export const PLACEHOLDER_ASSETS: Record<OfficeObjectType, PlaceholderAssetDef> & Record<string, PlaceholderAssetDef> = {
  desk: {
    emoji: '🪑',
    bgColor: OFFICE.woodMid,
    borderColor: OFFICE.woodDark,
  },
  computer: {
    emoji: '💻',
    bgColor: '#374151',
    borderColor: '#1f2937',
  },
  robot: {
    emoji: '🤖',
    bgColor: OFFICE.robotBody,
    borderColor: '#4f46e5',
  },
  'robot-idle': {
    emoji: '🤖',
    bgColor: OFFICE.idleGray,
    borderColor: '#4b5563',
  },
  'robot-working': {
    emoji: '🤖',
    bgColor: OFFICE.workingBlue,
    borderColor: OFFICE.workingBlueDim,
  },
  'robot-thinking': {
    emoji: '🤖',
    bgColor: OFFICE.thinkingAmber,
    borderColor: OFFICE.thinkingAmberDim,
  },
  'robot-error': {
    emoji: '🤖',
    bgColor: OFFICE.errorRed,
    borderColor: OFFICE.errorRedDim,
  },
  whiteboard: {
    emoji: '📋',
    bgColor: '#f3f4f6',
    borderColor: '#d1d5db',
  },
  bookshelf: {
    emoji: '📚',
    bgColor: OFFICE.woodLight,
    borderColor: OFFICE.woodDark,
  },
  door: {
    emoji: '🚪',
    bgColor: OFFICE.woodMid,
    borderColor: OFFICE.woodDark,
  },
  sign: {
    emoji: '🏷️',
    bgColor: OFFICE.signBg,
    borderColor: '#fbbf24',
  },
  delivery: {
    emoji: '📦',
    bgColor: '#059669',
    borderColor: '#047857',
  },
  'work-pile': {
    emoji: '📋',
    bgColor: '#d97706',
    borderColor: '#b45309',
  },
  'desk-empty': {
    emoji: '',
    bgColor: '#a6937e',
    borderColor: '#8b7d6b',
  },
};

/** Tile colors for canvas rendering (placeholder mode) */
export const TILE_COLORS: Record<TileId, string> = {
  'floor': OFFICE.floorMain,
  'floor-lobby': OFFICE.floorLobby,
  'wall-top': OFFICE.wallTop,
  'wall-bottom': OFFICE.wallSide,
  'wall-left': OFFICE.wallSide,
  'wall-right': OFFICE.wallSide,
  'wall-corner-tl': OFFICE.wallCorner,
  'wall-corner-tr': OFFICE.wallCorner,
  'wall-corner-bl': OFFICE.wallCorner,
  'wall-corner-br': OFFICE.wallCorner,
  'corridor': OFFICE.floorCorridor,
  'exterior': OFFICE.exterior,
};

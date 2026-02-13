/** Zerg-themed color palette for the RTS view */
export const ZERG = {
  // Creep & organic purples
  creepDark: '#1a0a2e',
  creepMid: '#2d1452',
  creepLight: '#4a2080',
  creepGlow: 'rgba(138, 43, 226, 0.25)',

  // Carapace (UI panels)
  carapaceBg: 'rgba(12, 6, 22, 0.92)',
  carapaceBorder: '#5a2d82',
  carapaceBorderDim: '#3a1a55',
  carapaceInset: 'rgba(90, 45, 130, 0.15)',
  carapaceHighlight: 'rgba(180, 100, 255, 0.08)',

  // Organic greens (activity)
  activeGreen: '#39ff14',
  activeGreenDim: '#1a8c0a',
  activeGreenGlow: 'rgba(57, 255, 20, 0.3)',

  // Amber (waiting/warning)
  waitingAmber: '#ffb300',
  waitingAmberDim: '#8c6200',
  waitingAmberGlow: 'rgba(255, 179, 0, 0.3)',

  // Red (high activity / danger)
  dangerRed: '#ff3b30',
  dangerRedDim: '#8c1a14',
  dangerRedGlow: 'rgba(255, 59, 48, 0.3)',

  // Text
  textPrimary: '#e8d5ff',
  textSecondary: '#b094d0',
  textMuted: '#7a5fa0',
  textFaint: '#4a3570',

  // Hatchery glow states
  hatcheryIdle: '#6b3fa0',
  hatcheryActive: '#39ff14',
  hatcheryWaiting: '#ffb300',

  // Unit colors
  droneBody: '#8b5cf6',
  droneGlow: 'rgba(139, 92, 246, 0.4)',
  overlordBody: '#4a3570',
  overlordGlow: 'rgba(74, 53, 112, 0.4)',

  // Terrain
  terrainBg: '#0a0514',
  terrainGrid: 'rgba(90, 45, 130, 0.12)',
  terrainSpot: 'rgba(138, 43, 226, 0.06)',

  // Nydus
  nydusBg: '#1a0a2e',
  nydusGlow: 'rgba(200, 100, 255, 0.3)',
  nydusRing: '#8b5cf6',

  // Building types
  spawningPool: '#0ea5e9',
  evolutionChamber: '#f59e0b',
  hydraDen: '#ef4444',
  extractor: '#22c55e',

  // Selection
  selectionRing: '#a855f7',
  selectionGlow: 'rgba(168, 85, 247, 0.5)',
} as const;

/** Crisp outline filter that follows sprite alpha shape — used for all selections */
export const SELECTION_OUTLINE_FILTER =
  'drop-shadow(2px 0 0 rgba(0,0,0,0.9)) drop-shadow(-2px 0 0 rgba(0,0,0,0.9)) drop-shadow(0 2px 0 rgba(0,0,0,0.9)) drop-shadow(0 -2px 0 rgba(0,0,0,0.9))';

/** Per-asset sprite configuration — sizes and label offsets tuned to each PNG */
export interface SpriteConfig {
  src: string;
  size: number;
  /** Label Y offset relative to top of container (use negative to pull up into sprite) */
  labelOffset: number;
}

export const SPRITE = {
  drone: { src: '/rts-drone.png', size: 80, labelOffset: 53 } satisfies SpriteConfig,
  overlord: { src: '/rts-overlord.png', size: 60, labelOffset: 56 } satisfies SpriteConfig,
  hatchery: { src: '/rts-hatchery.png', size: 90, labelOffset: 88 } satisfies SpriteConfig,
  nydus: { src: '/rts-nydus.png', size: 70, labelOffset: 68 } satisfies SpriteConfig,
  spawningPool: { src: '/rts-pool.png', size: 64, labelOffset: 62 } satisfies SpriteConfig,
  evoChamber: { src: '/rts-evo-chamber.png', size: 56, labelOffset: 54 } satisfies SpriteConfig,
} as const;

/** Building type labels and colors based on worktree characteristics */
export function getBuildingType(opts: {
  isMain: boolean;
  hasOpenPR: boolean;
  sessionCount: number;
}): { label: string; color: string; icon: string } {
  if (opts.isMain) {
    return { label: 'Spawning Pool', color: ZERG.spawningPool, icon: '🏊' };
  }
  if (opts.hasOpenPR) {
    return { label: 'Evolution Chamber', color: ZERG.evolutionChamber, icon: '🧬' };
  }
  if (opts.sessionCount >= 3) {
    return { label: 'Hydralisk Den', color: ZERG.dangerRed, icon: '🐍' };
  }
  return { label: 'Extractor', color: ZERG.extractor, icon: '⛏️' };
}

/**
 * How often the floor is drawn. Drawing the whole floor costs, and most of the time nothing calls for 60 frames a
 * second: the draw loop asks here, at each animation frame, how long to wait since the last frame it drew.
 *
 * - Someone is at it (a pointer, a key, a wheel, the camera gliding, a selection): 60 a second, for a moment after the
 *   last of these, so a drag stays smooth.
 * - The floor is not stopped: 30 a second, enough for chevrons and arms. Its belts turn whether or not they carry
 *   anything: a floor whose belts stand still reads as a floor that is stopped.
 * - The window is not the one in front: 15 a second. It may well be watched, on another screen: its belts turn there
 *   too.
 * - The floor is stopped and nothing moves on it: twice a second, only to catch what nothing told the loop about (the
 *   theme, a font come late). Its clock stands still, so there is nothing to animate. What changes on it (a fresh
 *   snapshot, a layout) is drawn at once: the loop is told (`FactoryPage.tsx`), it does not wait for its turn.
 *
 * Most of these frames cost little: while nothing moves on the floor, the view keeps the picture and paints only the
 * chevrons anew (`FactoryView`, "the picture kept in layers").
 */

/** How long after the last sign of life the floor keeps its full rate. Longer than a ticket's jump (0.6 s). */
export const AWAKE_MS = 1500;

const HZ = { awake: 60, running: 30, behind: 15, still: 2 } as const;

/**
 * The frame to frame time is never exactly 1000/hz: a frame that comes a hair early is still drawn, so a 60 Hz screen
 * draws them all at 60, and a 120 Hz one every other.
 */
const SLACK_MS = 2;

export interface FrameState {
  /** ms since the last sign of life (input, camera, snapshot, render). */
  sinceWake: number;
  /** The window is the one in front. */
  focused: boolean;
  /** The floor is not stopped: its belts turn. */
  running: boolean;
  /** Something moves on the floor, stopped or not: a ticket slides to where it was put (`FactoryView.moving`). */
  moving: boolean;
}

/** The time, in ms, the loop waits after a drawn frame before it draws the next one. */
export function frameGap(s: FrameState): number {
  const live = s.running || s.moving;
  const hz = !s.focused ? (live ? HZ.behind : HZ.still) : s.sinceWake < AWAKE_MS ? HZ.awake : live ? HZ.running : HZ.still;
  return 1000 / hz - SLACK_MS;
}

/**
 * The longest step of the floor's clock, in seconds: a frame that comes later than that (the page was hidden, the
 * floor was at rest) does not make what moves jump. Longer than the slowest rate at which something moves.
 */
export const MAX_STEP_S = 0.25;

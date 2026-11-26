/**
 * How often the floor is drawn. Drawing the whole floor costs, and most of the time nothing calls for 60 frames a
 * second: the draw loop asks here, at each animation frame, how long to wait since the last frame it drew.
 *
 * - Someone is at it (a pointer, a key, a wheel, the camera gliding, a selection): 60 a second, for a moment after the
 *   last of these, so a drag stays smooth.
 * - Something moves on the floor (a ticket on a belt or sliding to its place, an arm that swings): 30 a second, enough
 *   for chevrons and arms.
 * - Nothing moves, but something pulses, blinks or walks (a ticket that calls for someone, a lamp, a worker, the
 *   people of the decor): 10 a second, which such things read well at.
 * - The window is not the one in front: half of that; it is watched from the corner of an eye.
 * - Nothing moves at all, the floor at rest or stopped: twice a second, only to catch what nothing told the loop about
 *   (the theme, a font come late). Its belts stand still, so there is nothing to animate. What changes on it (a fresh
 *   snapshot, a layout) is drawn at once: the loop is told (`FactoryPage.tsx`), it does not wait for its turn.
 *
 * A floor that merely is not stopped used to be drawn 30 times a second, whole, for its chevrons alone: on a screen
 * of 120 Hz that kept a laptop's fans on with nothing happening.
 */

/** How long after the last sign of life the floor keeps its full rate. Longer than a ticket's jump (0.6 s). */
export const AWAKE_MS = 1500;

const HZ = { awake: 60, moving: 30, movingBehind: 15, ambient: 10, ambientBehind: 5, still: 2 } as const;

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
  /** Something moves on the floor: a ticket, an arm (`FactoryView.moving`). */
  moving: boolean;
  /** Nothing moves, but something pulses, blinks or walks (`FactoryView.ambient`). */
  ambient?: boolean;
}

/** The time, in ms, the loop waits after a drawn frame before it draws the next one. */
export function frameGap(s: FrameState): number {
  const hz = s.focused && s.sinceWake < AWAKE_MS ? HZ.awake
    : s.moving ? (s.focused ? HZ.moving : HZ.movingBehind)
    : s.ambient ? (s.focused ? HZ.ambient : HZ.ambientBehind)
    : HZ.still;
  return 1000 / hz - SLACK_MS;
}

/**
 * The longest step of the floor's clock, in seconds: a frame that comes later than that (the page was hidden, the
 * floor was at rest) does not make what moves jump. Longer than the slowest rate at which something moves.
 */
export const MAX_STEP_S = 0.25;

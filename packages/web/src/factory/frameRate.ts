/**
 * How often the floor is drawn. Drawing the whole floor costs, and most of the time nothing calls for 60 frames a
 * second: the draw loop asks here, at each animation frame, how long to wait since the last frame it drew.
 *
 * - Someone is at it (a pointer, a key, a wheel, the camera gliding, a fresh snapshot, a selection): 60 a second,
 *   for a moment after the last of these, so a drag or a ticket's jump stays smooth.
 * - The floor runs on its own, its belts turning: 30 a second, enough for chevrons and arms.
 * - The window is not the one in front: 15 a second while the floor runs; it is watched from the corner of an eye.
 * - The floor is stopped and nothing happens: twice a second, only to catch what nothing told the loop about
 *   (the theme, a font come late). Its clock stands still, so there is nothing to animate.
 */

/** How long after the last sign of life the floor keeps its full rate. Longer than a ticket's jump (0.6 s). */
export const AWAKE_MS = 1500;

const HZ = { awake: 60, running: 30, background: 15, still: 2 } as const;

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
  /** The floor runs: belts turn, arms swing. */
  running: boolean;
}

/** The time, in ms, the loop waits after a drawn frame before it draws the next one. */
export function frameGap(s: FrameState): number {
  const hz = !s.focused ? (s.running ? HZ.background : HZ.still)
    : s.sinceWake < AWAKE_MS ? HZ.awake
    : s.running ? HZ.running : HZ.still;
  return 1000 / hz - SLACK_MS;
}

/**
 * How an arm is drawn between two snapshots of the floor. The server only says,
 * a couple of times a second, how far an arm had swung and which way it was
 * going; drawn as told, the arm would jump from one pose to the next. Here it
 * keeps turning at its own pace from what was last said, and what is shown
 * closes in on that at a bounded speed, so the half turn is continuous whatever
 * the timing of the snapshots.
 */

export interface ArmReport { p: number; state: 'rest' | 'carry' | 'back' }

/** Where the arm should be by now: `age` seconds after a report, turning one way in `swing` seconds. */
export function armDue(report: ArmReport | undefined, age: number, swing: number): number {
  if (!report) return 0;
  const turned = Math.max(0, Math.min(age, 2)) / swing;
  if (report.state === 'carry') return Math.min(1, report.p + turned);
  if (report.state === 'back') return Math.max(0, report.p - turned);
  return 0;
}

/** How fast the drawn arm may catch up with where it should be, against its own pace: a little faster, never a jump. */
export const CATCH_UP = 1.6;

/** The swing to draw this frame (0 at the source, 1 at the destination), `dt` seconds after the last one drawn at `shown`. */
export function armShown(shown: number | undefined, due: number, dt: number, swing: number): number {
  if (shown === undefined) return due;
  const reach = (Math.max(0, dt) / swing) * CATCH_UP;
  return shown + Math.max(-reach, Math.min(reach, due - shown));
}

/** Ease in and out of the half turn: the arm starts and stops gently instead of at full speed. */
export const easeSwing = (p: number): number => p * p * (3 - 2 * p);

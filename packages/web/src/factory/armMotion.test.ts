import { describe, it, expect } from 'vitest';
import { armDue, armShown, CATCH_UP, easeSwing, type ArmReport } from './armMotion';

const SWING = 1.1, FRAME = 1 / 60;

/** Draw an arm for a while, fed a report every `poll` seconds by a server that ticks every quarter second, as the real one does. */
function play(seconds: number, poll: number, cycle: (t: number) => ArmReport): number[] {
  const drawn: number[] = [];
  let shown: number | undefined, report: ArmReport | undefined, at = 0;
  for (let t = 0; t < seconds; t += FRAME) {
    if (report === undefined || t - at >= poll) { report = cycle(Math.floor(t / 0.25) * 0.25); at = t; }
    shown = armShown(shown, armDue(report, t - at, SWING), FRAME, SWING);
    drawn.push(shown);
  }
  return drawn;
}
/** One arm at work: it carries for a swing, comes back for a swing, rests a little, and starts again. */
const working = (t: number): ArmReport => {
  const u = t % (SWING * 2 + 0.6);
  return u < SWING ? { p: u / SWING, state: 'carry' } : u < SWING * 2 ? { p: 1 - (u - SWING) / SWING, state: 'back' } : { p: 0, state: 'rest' };
};

describe('arm motion between snapshots', () => {
  it('keeps turning from what the server last said', () => {
    expect(armDue({ p: 0.2, state: 'carry' }, 0.55, SWING)).toBeCloseTo(0.7);
    expect(armDue({ p: 0.9, state: 'carry' }, 5, SWING)).toBe(1);       // it stops at its destination, however old the report
    expect(armDue({ p: 0.4, state: 'back' }, 0.22, SWING)).toBeCloseTo(0.2);
    expect(armDue({ p: 0.4, state: 'back' }, 5, SWING)).toBe(0);
    expect(armDue({ p: 0, state: 'rest' }, 1, SWING)).toBe(0);
    expect(armDue(undefined, 1, SWING)).toBe(0);
  });

  it('draws the half turn in small steps, never a jump, with reports only every 0.6 s', () => {
    const drawn = play(8, 0.6, working);
    const steps = drawn.slice(1).map((p, i) => Math.abs(p - drawn[i]!));
    expect(Math.max(...steps)).toBeLessThanOrEqual((FRAME / SWING) * CATCH_UP + 1e-9);
    /* and it does go all the way round, both ways, not a few poses */
    expect(Math.max(...drawn)).toBeGreaterThan(0.97);
    expect(Math.min(...drawn.slice(120))).toBeLessThan(0.03);
    expect(new Set(drawn.map((p) => Math.round(p * 50))).size).toBeGreaterThan(45);
  });

  it('is as smooth when reports come late or irregularly', () => {
    for (const poll of [0.3, 0.6, 1.0]) {
      const drawn = play(8, poll, working), steps = drawn.slice(1).map((p, i) => Math.abs(p - drawn[i]!));
      expect(Math.max(...steps)).toBeLessThanOrEqual((FRAME / SWING) * CATCH_UP + 1e-9);
      expect(Math.max(...drawn)).toBeGreaterThan(0.9);
    }
  });

  it('starts where it is told the first time, then only moves towards where it should be', () => {
    expect(armShown(undefined, 0.6, FRAME, SWING)).toBe(0.6);
    expect(armShown(0.5, 0.5, FRAME, SWING)).toBe(0.5);
    expect(armShown(0.2, 1, FRAME, SWING)).toBeCloseTo(0.2 + (FRAME / SWING) * CATCH_UP);
    expect(armShown(0.8, 0, FRAME, SWING)).toBeCloseTo(0.8 - (FRAME / SWING) * CATCH_UP);
  });

  it('eases in and out of the turn', () => {
    expect([easeSwing(0), easeSwing(0.5), easeSwing(1)]).toEqual([0, 0.5, 1]);
    expect(easeSwing(0.1)).toBeLessThan(0.1);
    expect(easeSwing(0.9)).toBeGreaterThan(0.9);
  });
});
